// Package iperf wraps the iperf3 binary (BSD-3, shipped as an optional
// component or found on PATH) and parses its --json output. Covers MTU / MSS
// control per NETWORK_MODULE_PLAN.md tool #6.
package iperf

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// ErrNotInstalled means no `iperf3` binary was found.
var ErrNotInstalled = errors.New("iperf3 was not found on PATH — install it or add the bundled binary")

// Options for a client run.
type Options struct {
	Host     string
	Port     int
	Duration int  // seconds  (-t)
	Reverse  bool // server sends  (-R)
	Bidir    bool // both directions  (--bidir)
	UDP      bool // (-u)
	Parallel int  // parallel streams  (-P)
	Omit     int  // omit first N seconds  (-O)
	// Overrides — zero means "use iperf3 defaults".
	MSS     int    // --set-mss (TCP on-wire segment size)
	Length  int    // --length (UDP datagram / TCP buffer)
	Window  int    // --window (socket buffer)
	Bitrate string // --bitrate (e.g. "100M"); UDP mainly
	// ExtraArgs is appended verbatim after the built args (a dangerous subset
	// is rejected). Split on whitespace by the caller.
	ExtraArgs []string
}

// blockedFlag rejects extra args that would change the run's nature or write
// files. exec.Command already prevents shell injection; this is about intent.
func blockedFlag(tok string) bool {
	for _, bad := range []string{
		"-s", "--server", "-D", "--daemon", "-c", "--client",
		"-F", "--file", "--logfile", "--pidfile", "-J", "--json",
	} {
		if tok == bad || strings.HasPrefix(tok, bad+"=") {
			return true
		}
	}
	return false
}

// Stream is the sender/receiver summary.
type Stream struct {
	Bits        float64 `json:"bitsPerSecond"`
	Bytes       float64 `json:"bytes"`
	Retransmits int     `json:"retransmits,omitempty"`
	JitterMs    float64 `json:"jitterMs,omitempty"`
	LostPct     float64 `json:"lostPercent,omitempty"`
}

// Result — shape "scalar_series" (throughput over the run's intervals).
type Result struct {
	V        int       `json:"v"`
	OK       bool      `json:"ok"`
	Error    string    `json:"error,omitempty"`
	Protocol string    `json:"protocol"`
	Reverse  bool      `json:"reverse"`
	Sender   Stream    `json:"sender"`
	Receiver Stream    `json:"receiver"`
	Unit     string    `json:"unit"`
	Samples  []float64 `json:"samples"` // per-interval Mbps
	Stats    struct {
		Min, Avg, P50, P95, Max float64
	} `json:"stats"`
	MSS     int      `json:"mss,omitempty"`
	Length  int      `json:"length,omitempty"`
	Command []string `json:"command"` // the resolved arg list (binary basename + args)
	Raw     string   `json:"raw,omitempty"`
}

// resolveBin finds the iperf3 binary: the copy bundled next to the backend
// (`iperf3` / `iperf3.exe`, placed by build-sidecar from vendor-tools), else
// one on PATH.
func resolveBin() (string, bool) {
	names := []string{"iperf3"}
	if runtime.GOOS == "windows" {
		names = []string{"iperf3.exe"}
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		for _, n := range names {
			cand := filepath.Join(dir, n)
			if fi, err := os.Stat(cand); err == nil && !fi.IsDir() {
				return cand, true
			}
		}
	}
	if p, err := exec.LookPath("iperf3"); err == nil {
		return p, true
	}
	return "", false
}

// Available reports whether an iperf3 binary can be found.
func Available() bool {
	_, ok := resolveBin()
	return ok
}

// buildArgs turns Options into the iperf3 command line (without the binary).
// The result is also surfaced to the UI as a command preview.
func buildArgs(opts Options) []string {
	args := []string{"-c", opts.Host, "--json", "--connect-timeout", "5000"}
	if opts.Port > 0 {
		args = append(args, "-p", strconv.Itoa(opts.Port))
	}
	dur := opts.Duration
	if dur <= 0 || dur > 60 {
		dur = 10
	}
	args = append(args, "-t", strconv.Itoa(dur))
	if opts.Bidir {
		args = append(args, "--bidir")
	} else if opts.Reverse {
		args = append(args, "-R")
	}
	if opts.UDP {
		args = append(args, "-u")
	}
	if opts.Parallel > 1 {
		args = append(args, "-P", strconv.Itoa(opts.Parallel))
	}
	if opts.Omit > 0 {
		args = append(args, "-O", strconv.Itoa(opts.Omit))
	}
	if opts.MSS > 0 {
		args = append(args, "--set-mss", strconv.Itoa(opts.MSS))
	}
	if opts.Length > 0 {
		args = append(args, "-l", strconv.Itoa(opts.Length))
	}
	if opts.Window > 0 {
		args = append(args, "-w", strconv.Itoa(opts.Window))
	}
	if opts.Bitrate != "" {
		args = append(args, "-b", opts.Bitrate)
	}
	for _, tok := range opts.ExtraArgs {
		if tok = strings.TrimSpace(tok); tok != "" && !blockedFlag(tok) {
			args = append(args, tok)
		}
	}
	return args
}

// Run performs a client test and parses the JSON output.
func Run(ctx context.Context, opts Options) (Result, error) {
	bin, ok := resolveBin()
	if !ok {
		return Result{}, ErrNotInstalled
	}

	args := buildArgs(opts)

	cmd := exec.CommandContext(ctx, bin, args...)
	out, runErr := cmd.Output()
	// iperf3 exits non-zero on a test error but still prints JSON with an "error" key.

	res := parse(out)
	res.Reverse = opts.Reverse
	res.MSS = opts.MSS
	res.Length = opts.Length
	res.Command = append([]string{filepath.Base(bin)}, args...)
	if res.Protocol == "" {
		if opts.UDP {
			res.Protocol = "UDP"
		} else {
			res.Protocol = "TCP"
		}
	}
	if !res.OK && res.Error == "" && runErr != nil {
		res.Error = runErr.Error()
	}
	return res, nil
}

func parse(out []byte) Result {
	res := Result{V: 1, Unit: "Mbit/s"}
	var doc struct {
		Error string `json:"error"`
		Start struct {
			TestStart struct {
				Protocol string `json:"protocol"`
			} `json:"test_start"`
		} `json:"start"`
		Intervals []struct {
			Sum struct {
				BitsPerSecond float64 `json:"bits_per_second"`
			} `json:"sum"`
		} `json:"intervals"`
		End struct {
			SumSent struct {
				BitsPerSecond float64 `json:"bits_per_second"`
				Bytes         float64 `json:"bytes"`
				Retransmits   int     `json:"retransmits"`
			} `json:"sum_sent"`
			SumReceived struct {
				BitsPerSecond float64 `json:"bits_per_second"`
				Bytes         float64 `json:"bytes"`
			} `json:"sum_received"`
			Sum struct {
				JitterMs      float64 `json:"jitter_ms"`
				LostPercent   float64 `json:"lost_percent"`
				BitsPerSecond float64 `json:"bits_per_second"`
			} `json:"sum"`
		} `json:"end"`
	}
	if err := json.Unmarshal(out, &doc); err != nil {
		res.Error = fmt.Sprintf("could not parse iperf3 output: %v", err)
		return res
	}
	if doc.Error != "" {
		res.Error = doc.Error
		return res
	}

	res.OK = true
	res.Protocol = doc.Start.TestStart.Protocol
	for _, iv := range doc.Intervals {
		res.Samples = append(res.Samples, iv.Sum.BitsPerSecond/1e6)
	}
	res.Sender = Stream{Bits: doc.End.SumSent.BitsPerSecond, Bytes: doc.End.SumSent.Bytes, Retransmits: doc.End.SumSent.Retransmits}
	res.Receiver = Stream{Bits: doc.End.SumReceived.BitsPerSecond, Bytes: doc.End.SumReceived.Bytes}
	if doc.End.Sum.JitterMs > 0 || doc.End.Sum.LostPercent > 0 {
		res.Receiver.JitterMs = doc.End.Sum.JitterMs
		res.Receiver.LostPct = doc.End.Sum.LostPercent
		if len(res.Samples) == 0 {
			res.Samples = append(res.Samples, doc.End.Sum.BitsPerSecond/1e6)
		}
	}
	computeStats(&res)
	return res
}

func computeStats(res *Result) {
	if len(res.Samples) == 0 {
		return
	}
	s := append([]float64(nil), res.Samples...)
	for i := range s {
		for j := i + 1; j < len(s); j++ {
			if s[j] < s[i] {
				s[i], s[j] = s[j], s[i]
			}
		}
	}
	res.Stats.Min = s[0]
	res.Stats.Max = s[len(s)-1]
	res.Stats.P50 = s[len(s)/2]
	res.Stats.P95 = s[int(float64(len(s))*0.95)%len(s)]
	var sum float64
	for _, v := range res.Samples {
		sum += v
	}
	res.Stats.Avg = sum / float64(len(res.Samples))
}

var _ = time.Second
