// Package traceroute walks the path to a host by sending probes with an
// increasing TTL and recording who replies at each hop. The per-OS probe is in
// probe_windows.go / probe_other.go. See NETWORK_MODULE_PLAN.md tool #5.
package traceroute

import (
	"context"
	"net"
	"time"
)

// HopProbe is one probe's outcome at a given TTL.
type HopProbe struct {
	RTT      time.Duration
	Addr     string
	Reached  bool // this reply came from the destination
	TimedOut bool
}

// probeHop sends `count` probes at the given ttl toward dest and returns each result.
// Implemented per-OS.
func probeHop(ctx context.Context, dest net.IP, ttl, count int, timeout time.Duration) []HopProbe {
	return probeHopImpl(ctx, dest, ttl, count, timeout)
}

// Hop is the collated result for one TTL.
type Hop struct {
	TTL      int       `json:"ttl"`
	Addr     string    `json:"addr,omitempty"`
	Hostname string    `json:"hostname,omitempty"`
	RTTsMs   []float64 `json:"rttsMs"`
	Timeouts int       `json:"timeouts"`
	Reached  bool      `json:"reached"`
	// Geo fields, filled by the API layer when enabled.
	Country string  `json:"country,omitempty"`
	City    string  `json:"city,omitempty"`
	ISP     string  `json:"isp,omitempty"`
	Lat     float64 `json:"lat,omitempty"`
	Lon     float64 `json:"lon,omitempty"`
}

// Options configures the trace.
type Options struct {
	Host         string
	MaxHops      int
	ProbesPerHop int
	Timeout      time.Duration
	ResolveNames bool
}

// Emit receives ("hop", Hop) as each TTL completes.
type Emit func(event string, payload any)

// Result is the collated trace (also the `done` envelope result, shape "set").
type Result struct {
	V        int              `json:"v"`
	Host     string           `json:"host"`
	DestIP   string           `json:"destIp"`
	Hops     []Hop            `json:"hops"`
	Items    []map[string]any `json:"items"`
	Reached  bool             `json:"reached"`
	HopCount int              `json:"hopCount"`
}

// Run traces the route, streaming each hop. Returns the collated result.
func Run(ctx context.Context, opts Options, emit Emit) (Result, error) {
	maxHops := opts.MaxHops
	if maxHops <= 0 || maxHops > 64 {
		maxHops = 30
	}
	probes := opts.ProbesPerHop
	if probes <= 0 {
		probes = 3
	}
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 4 * time.Second
	}

	ipaddr, err := net.ResolveIPAddr("ip4", opts.Host)
	if err != nil {
		return Result{}, err
	}
	dest := ipaddr.IP

	res := Result{V: 1, Host: opts.Host, DestIP: dest.String()}

	for ttl := 1; ttl <= maxHops; ttl++ {
		if ctx.Err() != nil {
			break
		}
		results := probeHop(ctx, dest, ttl, probes, timeout)

		hop := Hop{TTL: ttl}
		for _, p := range results {
			if p.TimedOut {
				hop.Timeouts++
				continue
			}
			if hop.Addr == "" {
				hop.Addr = p.Addr
			}
			hop.RTTsMs = append(hop.RTTsMs, float64(p.RTT)/float64(time.Millisecond))
			if p.Reached {
				hop.Reached = true
			}
		}
		if hop.Addr != "" && opts.ResolveNames {
			if names, err := net.LookupAddr(hop.Addr); err == nil && len(names) > 0 {
				hop.Hostname = trimDot(names[0])
			}
		}

		res.Hops = append(res.Hops, hop)
		emit("hop", hop)

		if hop.Reached {
			res.Reached = true
			break
		}
	}

	res.HopCount = len(res.Hops)
	for _, h := range res.Hops {
		key := h.Addr
		if key == "" {
			key = "*"
		}
		res.Items = append(res.Items, map[string]any{
			"key":    key,
			"label":  itoa(h.TTL),
			"detail": h.Addr,
		})
	}
	return res, nil
}

func trimDot(s string) string {
	if len(s) > 0 && s[len(s)-1] == '.' {
		return s[:len(s)-1]
	}
	return s
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [12]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
