// Package traceroute walks the path to a host by sending probes with an
// increasing TTL and recording who replies at each hop. The per-OS probe is in
// probe_windows.go / probe_other.go. See NETWORK_MODULE_PLAN.md tool #5 and
// TRACEROUTE_PLUS_PLAN.md for the mtr/trippy-style continuous mode (T1a).
package traceroute

import (
	"context"
	"fmt"
	"math"
	"net"
	"time"
)

// Probe protocols.
const (
	ProtoICMP = "icmp"
	ProtoUDP  = "udp"
	ProtoTCP  = "tcp"
)

// HopProbe is one probe's outcome at a given TTL.
type HopProbe struct {
	RTT      time.Duration
	Addr     string
	Reached  bool // this reply came from the destination
	TimedOut bool
}

// probeCfg is one TTL's probe request, passed to the per-OS implementation.
type probeCfg struct {
	dest    net.IP
	ttl     int
	count   int
	timeout time.Duration
	proto   string // ProtoICMP | ProtoUDP | ProtoTCP
	port    int    // dest port for UDP / TCP
	size    int    // payload size (ICMP / UDP)
}

// probeHop sends `cfg.count` probes at `cfg.ttl` and returns each result.
// Implemented per-OS in probe_windows.go / probe_other.go.
func probeHop(ctx context.Context, cfg probeCfg) []HopProbe {
	return probeHopImpl(ctx, cfg)
}

// Hop is the collated result for one TTL (legacy single-sweep shape, kept for
// the current UI and the `done` envelope).
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

// HopStat is one hop's rolling statistics across all rounds so far — the
// mtr-style row. Streamed as the `hop-update` event.
type HopStat struct {
	TTL      int       `json:"ttl"`
	Addrs    []string  `json:"addrs"` // >1 = ECMP
	Addr     string    `json:"addr"`  // last / primary responder
	Hostname string    `json:"hostname,omitempty"`
	Sent     int       `json:"sent"`
	Recv     int       `json:"recv"`
	LossPct  float64   `json:"lossPct"`
	LastMs   float64   `json:"lastMs"`
	BestMs   float64   `json:"bestMs"`
	WorstMs  float64   `json:"worstMs"`
	AvgMs    float64   `json:"avgMs"`
	StdevMs  float64   `json:"stdevMs"`
	JitterMs float64   `json:"jitterMs"` // EWMA of |Δrtt|
	Recent   []float64 `json:"recent"`   // last ~30 RTTs, for the sparkline
	Reached  bool      `json:"reached"`
	Changed  bool      `json:"changed,omitempty"` // primary responder changed since the last round
	// ASN, filled by the API layer when enabled.
	ASN    string `json:"asn,omitempty"`
	ASName string `json:"asName,omitempty"`
	// Geo, filled by the API layer when enabled.
	Country string  `json:"country,omitempty"`
	City    string  `json:"city,omitempty"`
	ISP     string  `json:"isp,omitempty"`
	Lat     float64 `json:"lat,omitempty"`
	Lon     float64 `json:"lon,omitempty"`
}

// recentCap bounds the per-hop RTT ring used for the sparkline.
const recentCap = 30

// hopAgg folds probe results for one TTL across rounds.
type hopAgg struct {
	ttl      int
	addrs    []string
	last     string
	hostname string
	sent     int
	recv     int
	lastMs   float64
	bestMs   float64
	worstMs  float64
	sumMs    float64
	sumSqMs  float64
	prevMs   float64
	jitterMs float64
	recent   []float64
	reached  bool
	changed  bool
}

func (a *hopAgg) add(p HopProbe) {
	a.sent++
	if p.TimedOut {
		return
	}
	a.recv++
	ms := float64(p.RTT) / float64(time.Millisecond)
	a.lastMs = ms
	if p.Addr != "" {
		if a.last != "" && a.last != p.Addr {
			a.changed = true
		}
		a.last = p.Addr
		if !contains(a.addrs, p.Addr) {
			a.addrs = append(a.addrs, p.Addr)
		}
	}
	if a.recv == 1 || ms < a.bestMs {
		a.bestMs = ms
	}
	if ms > a.worstMs {
		a.worstMs = ms
	}
	a.sumMs += ms
	a.sumSqMs += ms * ms
	if a.recv > 1 {
		d := math.Abs(ms - a.prevMs)
		a.jitterMs += (d - a.jitterMs) / 16 // RFC 3550-style EWMA
	}
	a.prevMs = ms
	a.recent = append(a.recent, ms)
	if len(a.recent) > recentCap {
		a.recent = a.recent[len(a.recent)-recentCap:]
	}
	if p.Reached {
		a.reached = true
	}
}

func (a *hopAgg) stat() HopStat {
	s := HopStat{
		TTL: a.ttl, Addrs: a.addrs, Addr: a.last, Hostname: a.hostname,
		Sent: a.sent, Recv: a.recv, Reached: a.reached, Recent: a.recent,
		Changed: a.changed,
	}
	a.changed = false
	if s.Addrs == nil {
		s.Addrs = []string{}
	}
	if s.Recent == nil {
		s.Recent = []float64{}
	}
	if a.sent > 0 {
		s.LossPct = round2(float64(a.sent-a.recv) / float64(a.sent) * 100)
	}
	if a.recv > 0 {
		s.LastMs = round2(a.lastMs)
		s.BestMs = round2(a.bestMs)
		s.WorstMs = round2(a.worstMs)
		s.AvgMs = round2(a.sumMs / float64(a.recv))
		s.JitterMs = round2(a.jitterMs)
		if a.recv > 1 {
			v := (a.sumSqMs - a.sumMs*a.sumMs/float64(a.recv)) / float64(a.recv-1)
			if v > 0 {
				s.StdevMs = round2(math.Sqrt(v))
			}
		}
	}
	return s
}

// toHop renders the aggregate in the legacy single-sweep shape for the `done`
// envelope.
func (a *hopAgg) toHop() Hop {
	h := Hop{
		TTL: a.ttl, Addr: a.last, Hostname: a.hostname,
		Reached: a.reached, Timeouts: a.sent - a.recv,
		RTTsMs: append([]float64{}, a.recent...),
	}
	if h.RTTsMs == nil {
		h.RTTsMs = []float64{}
	}
	return h
}

// Options configures the trace.
type Options struct {
	Host         string
	MaxHops      int
	ProbesPerHop int
	Timeout      time.Duration
	ResolveNames bool
	// Rounds: 0 → a single sweep (legacy); N → N sweeps; <0 → sweep until the
	// context is cancelled. Interval is the pause between sweeps (default 1s).
	Rounds   int
	Interval time.Duration
	// Protocol: "" / "icmp" (default), "udp", or "tcp". UDP/TCP path tracing
	// needs a raw ICMP socket to see time-exceeded replies and is currently
	// POSIX-only (see probe_windows.go). Port is the destination port for
	// UDP/TCP.
	Protocol string
	Port     int
}

// SupportedProtocols reports which probe protocols this OS build can run.
func SupportedProtocols() []string { return supportedProtos() }

// Emit receives ("hop", Hop) on the first round and ("hop-update", HopStat)
// after every hop of every round.
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
	Rounds   int              `json:"rounds"`
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
	rounds := opts.Rounds
	if rounds == 0 {
		rounds = 1
	}
	interval := opts.Interval
	if interval <= 0 {
		interval = time.Second
	}
	proto := opts.Protocol
	if proto == "" {
		proto = ProtoICMP
	}
	if !contains(supportedProtos(), proto) {
		return Result{}, fmt.Errorf("%s path tracing is not available on this host — use ICMP mode", proto)
	}
	port := opts.Port
	if port <= 0 || port > 65535 {
		if proto == ProtoTCP {
			port = 80
		} else {
			port = 33434
		}
	}

	ipaddr, err := net.ResolveIPAddr("ip4", opts.Host)
	if err != nil {
		return Result{}, err
	}
	dest := ipaddr.IP
	res := Result{V: 1, Host: opts.Host, DestIP: dest.String()}

	aggs := make([]*hopAgg, maxHops)
	for i := range aggs {
		aggs[i] = &hopAgg{ttl: i + 1}
	}
	lastTTL := maxHops // shrinks once a sweep reaches the destination

	for round := 0; rounds < 0 || round < rounds; round++ {
		if ctx.Err() != nil {
			break
		}
		if round > 0 {
			select {
			case <-time.After(interval):
			case <-ctx.Done():
			}
			if ctx.Err() != nil {
				break
			}
		}
		emit("round", round+1)

		for ttl := 1; ttl <= lastTTL; ttl++ {
			if ctx.Err() != nil {
				break
			}
			a := aggs[ttl-1]
			results := probeHop(ctx, probeCfg{
				dest: dest, ttl: ttl, count: probes, timeout: timeout,
				proto: proto, port: port,
			})
			for _, p := range results {
				a.add(p)
			}
			if a.hostname == "" && a.last != "" && opts.ResolveNames {
				rctx, rcancel := context.WithTimeout(ctx, 800*time.Millisecond)
				if names, lerr := net.DefaultResolver.LookupAddr(rctx, a.last); lerr == nil && len(names) > 0 {
					a.hostname = trimDot(names[0])
				}
				rcancel()
			}

			emit("hop-update", a.stat())
			if round == 0 {
				emit("hop", legacyHop(a.ttl, results, a.hostname))
			}

			if a.reached && ttl < lastTTL {
				lastTTL = ttl
			}
		}
		res.Rounds = round + 1
	}

	for ttl := 1; ttl <= lastTTL; ttl++ {
		a := aggs[ttl-1]
		res.Hops = append(res.Hops, a.toHop())
		if a.reached {
			res.Reached = true
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

// legacyHop builds the old single-sweep Hop from one round's raw probes.
func legacyHop(ttl int, results []HopProbe, hostname string) Hop {
	h := Hop{TTL: ttl, Hostname: hostname}
	for _, p := range results {
		if p.TimedOut {
			h.Timeouts++
			continue
		}
		if h.Addr == "" {
			h.Addr = p.Addr
		}
		h.RTTsMs = append(h.RTTsMs, float64(p.RTT)/float64(time.Millisecond))
		if p.Reached {
			h.Reached = true
		}
	}
	if h.RTTsMs == nil {
		h.RTTsMs = []float64{}
	}
	return h
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func round2(f float64) float64 { return math.Round(f*100) / 100 }

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
