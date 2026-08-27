// Package netscan discovers live hosts on a network by ICMP echo + reverse DNS,
// with an optional TCP port probe. ARP-based discovery (needs libpcap/Npcap and
// raw sockets) is a later, optional component — see NETWORK_MODULE_PLAN.md
// tool #2.
package netscan

import (
	"context"
	"net"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/infrakit/backend/internal/tools/ping"
)

// HostResult is one discovered (or probed-and-dead) host.
type HostResult struct {
	IP        string   `json:"ip"`
	Alive     bool     `json:"alive"`
	RTTMs     float64  `json:"rttMs,omitempty"`
	Hostname  string   `json:"hostname,omitempty"`
	OpenPorts []int    `json:"openPorts,omitempty"`
	Services  []string `json:"services,omitempty"`
}

// Progress is emitted periodically.
type Progress struct {
	Scanned int `json:"scanned"`
	Total   int `json:"total"`
	Alive   int `json:"alive"`
}

// Options configures the sweep.
type Options struct {
	Hosts        []string
	Timeout      time.Duration
	Concurrency  int
	ResolveNames bool
	ProbePorts   []int  // empty = ICMP only
	SourceIP     string // bind port probes to this local address (from the interface picker); "" = default route
	ShowDead     bool
}

// Emit receives ("host", HostResult) and ("progress", Progress).
type Emit func(event string, payload any)

// Result is the collated scan (also the `done` envelope, shape "table").
type Result struct {
	V     int          `json:"v"`
	Hosts []HostResult `json:"hosts"`
	Alive int          `json:"alive"`
	Total int          `json:"total"`
}

// Scan sweeps every host concurrently and streams results.
func Scan(ctx context.Context, opts Options, emit Emit) Result {
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 2 * time.Second
	}
	conc := opts.Concurrency
	if conc <= 0 || conc > 256 {
		conc = 64
	}

	var (
		mu       sync.Mutex
		alive    int
		scanned  int
		results  []HostResult
		lastEmit time.Time
	)

	sem := make(chan struct{}, conc)
	var wg sync.WaitGroup
	for _, host := range opts.Hosts {
		select {
		case <-ctx.Done():
			goto collate
		case sem <- struct{}{}:
		}
		wg.Add(1)
		go func(host string) {
			defer wg.Done()
			defer func() { <-sem }()
			r := probeHost(ctx, host, opts, timeout)

			mu.Lock()
			scanned++
			if r.Alive {
				alive++
			}
			if r.Alive || opts.ShowDead {
				results = append(results, r)
			}
			n, a := scanned, alive
			doEmit := time.Since(lastEmit) > 150*time.Millisecond || n == len(opts.Hosts)
			if doEmit {
				lastEmit = time.Now()
			}
			mu.Unlock()

			if r.Alive || opts.ShowDead {
				emit("host", r)
			}
			if doEmit {
				emit("progress", Progress{Scanned: n, Total: len(opts.Hosts), Alive: a})
			}
		}(host)
	}

collate:
	wg.Wait()

	sort.Slice(results, func(i, j int) bool { return ipLess(results[i].IP, results[j].IP) })
	return Result{V: 1, Hosts: results, Alive: alive, Total: len(opts.Hosts)}
}

func probeHost(ctx context.Context, host string, opts Options, timeout time.Duration) HostResult {
	r := HostResult{IP: host}
	if rep, err := ping.Echo(ctx, host, timeout); err == nil {
		r.Alive = true
		r.RTTMs = float64(rep.RTT) / float64(time.Millisecond)
	}

	if !r.Alive && len(opts.ProbePorts) == 0 {
		return r
	}

	if opts.ResolveNames {
		if names, err := net.LookupAddr(host); err == nil && len(names) > 0 {
			r.Hostname = trimDot(names[0])
		}
	}

	for _, port := range opts.ProbePorts {
		if tcpOpen(ctx, opts.SourceIP, host, port, timeout) {
			r.Alive = true // a listening port means the host is up even if ICMP is filtered
			r.OpenPorts = append(r.OpenPorts, port)
		}
	}
	return r
}

func tcpOpen(ctx context.Context, sourceIP, host string, port int, timeout time.Duration) bool {
	d := net.Dialer{Timeout: timeout}
	if sourceIP != "" {
		if ip := net.ParseIP(sourceIP); ip != nil {
			d.LocalAddr = &net.TCPAddr{IP: ip}
		}
	}
	c, err := d.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return false
	}
	_ = c.Close()
	return true
}

func trimDot(s string) string {
	if len(s) > 0 && s[len(s)-1] == '.' {
		return s[:len(s)-1]
	}
	return s
}

func ipLess(a, b string) bool {
	ipa, ipb := net.ParseIP(a), net.ParseIP(b)
	if ipa == nil || ipb == nil {
		return a < b
	}
	a4, b4 := ipa.To4(), ipb.To4()
	if a4 != nil && b4 != nil {
		for i := 0; i < 4; i++ {
			if a4[i] != b4[i] {
				return a4[i] < b4[i]
			}
		}
		return false
	}
	return a < b
}
