// Package ping does one-shot ICMP echo and a continuous multi-host monitor —
// the Ping Monitor tool. Uses an unprivileged path per-OS (IcmpSendEcho on
// Windows, datagram/pro-bing elsewhere). See NETWORK_MODULE_PLAN.md tool #4.
package ping

import (
	"context"
	"math"
	"sort"
	"sync"
	"time"
)

// Reply is one echo response.
type Reply struct {
	RTT  time.Duration
	TTL  int
	Addr string
}

// echo sends a single ICMP echo to host and waits up to timeout. Implemented
// per-OS in ping_windows.go / ping_other.go.
func echo(ctx context.Context, host string, timeout time.Duration) (Reply, error) {
	return echoImpl(ctx, host, timeout)
}

// Sample is one probe result in the monitor stream.
type Sample struct {
	Host  string  `json:"host"`
	Seq   int     `json:"seq"`
	OK    bool    `json:"ok"`
	RTTMs float64 `json:"rttMs"`
	TTL   int     `json:"ttl,omitempty"`
	Error string  `json:"error,omitempty"`
}

// Stats is the rolling summary for one host.
type Stats struct {
	Host      string  `json:"host"`
	Sent      int     `json:"sent"`
	Received  int     `json:"received"`
	LossPct   float64 `json:"lossPct"`
	MinMs     float64 `json:"minMs"`
	AvgMs     float64 `json:"avgMs"`
	MaxMs     float64 `json:"maxMs"`
	P95Ms     float64 `json:"p95Ms"`
	JitterMs  float64 `json:"jitterMs"`
	Status    string  `json:"status"` // "up" | "down" | "pending"
	LastRTTMs float64 `json:"lastRttMs"`
}

// Options for the monitor.
type Options struct {
	Hosts             []string
	Interval          time.Duration
	Timeout           time.Duration
	UpThreshold       int // consecutive OK to mark up
	DownThreshold     int // consecutive fail to mark down
	MaxSamplesPerHost int
}

// Emit receives ("sample", Sample), ("stats", Stats), ("status", Stats).
type Emit func(event string, payload any)

type hostState struct {
	mu         sync.Mutex
	seq        int
	sent       int
	recv       int
	rtts       []float64 // milliseconds, capped
	consecOK   int
	consecFail int
	status     string
	lastRTT    float64
}

// HostFinal is the end-of-run summary for one host.
type HostFinal struct {
	Stats   Stats     `json:"stats"`
	Samples []float64 `json:"samples"` // RTT milliseconds, in order
}

// Monitor pings every host on Interval until ctx is cancelled, streaming
// samples + rolling stats, and returns the final per-host summary.
func Monitor(ctx context.Context, opts Options, emit Emit) map[string]HostFinal {
	interval := opts.Interval
	if interval <= 0 {
		interval = time.Second
	}
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 4 * time.Second
	}
	up := opts.UpThreshold
	if up <= 0 {
		up = 1
	}
	down := opts.DownThreshold
	if down <= 0 {
		down = 3
	}
	cap := opts.MaxSamplesPerHost
	if cap <= 0 {
		cap = 3600
	}

	states := make(map[string]*hostState, len(opts.Hosts))
	for _, h := range opts.Hosts {
		states[h] = &hostState{status: "pending"}
	}

	var wg sync.WaitGroup
	for _, host := range opts.Hosts {
		wg.Add(1)
		go func(host string, st *hostState) {
			defer wg.Done()
			t := time.NewTicker(interval)
			defer t.Stop()
			probe(ctx, host, st, timeout, up, down, cap, emit)
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					probe(ctx, host, st, timeout, up, down, cap, emit)
				}
			}
		}(host, states[host])
	}
	wg.Wait()

	final := make(map[string]HostFinal, len(states))
	for h, st := range states {
		final[h] = HostFinal{Stats: st.snapshot(h), Samples: append([]float64(nil), st.rtts...)}
	}
	return final
}

func probe(ctx context.Context, host string, st *hostState, timeout time.Duration, up, down, cap int, emit Emit) {
	st.mu.Lock()
	st.seq++
	st.sent++
	seq := st.seq
	st.mu.Unlock()

	rep, err := echo(ctx, host, timeout)
	if ctx.Err() != nil {
		return
	}

	st.mu.Lock()
	sample := Sample{Host: host, Seq: seq}
	prevStatus := st.status
	if err != nil {
		st.consecFail++
		st.consecOK = 0
		sample.OK = false
		sample.Error = err.Error()
		if st.consecFail >= down {
			st.status = "down"
		}
	} else {
		rttMs := float64(rep.RTT) / float64(time.Millisecond)
		st.recv++
		st.consecOK++
		st.consecFail = 0
		st.lastRTT = rttMs
		st.rtts = append(st.rtts, rttMs)
		if len(st.rtts) > cap {
			st.rtts = st.rtts[len(st.rtts)-cap:]
		}
		sample.OK = true
		sample.RTTMs = rttMs
		sample.TTL = rep.TTL
		if st.consecOK >= up {
			st.status = "up"
		}
	}
	stats := st.snapshot(host)
	changed := st.status != prevStatus
	st.mu.Unlock()

	emit("sample", sample)
	emit("stats", stats)
	if changed {
		emit("status", stats)
	}
}

func (st *hostState) snapshot(host string) Stats {
	s := Stats{Host: host, Sent: st.sent, Received: st.recv, Status: st.status, LastRTTMs: round(st.lastRTT)}
	if st.sent > 0 {
		s.LossPct = round(float64(st.sent-st.recv) / float64(st.sent) * 100)
	}
	if len(st.rtts) == 0 {
		return s
	}
	sorted := append([]float64(nil), st.rtts...)
	sort.Float64s(sorted)
	s.MinMs = round(sorted[0])
	s.MaxMs = round(sorted[len(sorted)-1])
	s.P95Ms = round(percentile(sorted, 95))
	var sum float64
	for _, v := range st.rtts {
		sum += v
	}
	s.AvgMs = round(sum / float64(len(st.rtts)))
	s.JitterMs = round(meanAbsDelta(st.rtts))
	return s
}

func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(math.Ceil(p/100*float64(len(sorted)))) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

func meanAbsDelta(v []float64) float64 {
	if len(v) < 2 {
		return 0
	}
	var sum float64
	for i := 1; i < len(v); i++ {
		sum += math.Abs(v[i] - v[i-1])
	}
	return sum / float64(len(v)-1)
}

func round(n float64) float64 {
	return math.Round(n*100) / 100
}
