// Package portscan runs a concurrent TCP connect scan across hosts and ports.
// Native (no raw sockets, no privileges) — covers the common case; SYN / UDP
// via nmap is a later addition. See NETWORK_MODULE_PLAN.md tool #3.
package portscan

import (
	"context"
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// PortState is the outcome of probing one port.
type PortState string

const (
	StateOpen     PortState = "open"
	StateClosed   PortState = "closed"
	StateTimedOut PortState = "timeout"
)

// PortResult is one probed host:port.
type PortResult struct {
	Host    string    `json:"host"`
	Port    int       `json:"port"`
	State   PortState `json:"state"`
	Service string    `json:"service,omitempty"`
}

// Progress is emitted periodically during the scan.
type Progress struct {
	Scanned   int `json:"scanned"`
	Total     int `json:"total"`
	OpenCount int `json:"openCount"`
}

// Options configures the scan.
type Options struct {
	Hosts           []string
	Ports           []int
	Timeout         time.Duration
	HostConcurrency int
	PortConcurrency int
	ShowClosed      bool
}

// Emit receives scan events: ("open"|"closed", PortResult) and ("progress", Progress).
type Emit func(event string, payload any)

// Result is the collated scan output (also the `done` envelope's result). Shape "set".
type Result struct {
	V     int              `json:"v"`
	Open  []PortResult     `json:"open"`
	Items []map[string]any `json:"items"`
	Total int              `json:"total"`
}

// Scan probes every host×port with two levels of bounded concurrency and streams
// results through emit. Returns the collated Result.
func Scan(ctx context.Context, opts Options, emit Emit) Result {
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 4 * time.Second
	}
	hostC := clamp(opts.HostConcurrency, 1, 64, 4)
	portC := clamp(opts.PortConcurrency, 1, 512, 128)
	total := len(opts.Hosts) * len(opts.Ports)

	var (
		mu       sync.Mutex
		open     []PortResult
		scanned  int
		lastEmit time.Time
	)

	report := func(res PortResult) {
		mu.Lock()
		scanned++
		if res.State == StateOpen {
			open = append(open, res)
		}
		n, oc := scanned, len(open)
		emitProgress := time.Since(lastEmit) > 150*time.Millisecond || n == total
		if emitProgress {
			lastEmit = time.Now()
		}
		mu.Unlock()

		if res.State == StateOpen {
			emit("open", res)
		} else if opts.ShowClosed {
			emit("closed", res)
		}
		if emitProgress {
			emit("progress", Progress{Scanned: n, Total: total, OpenCount: oc})
		}
	}

	hostSem := make(chan struct{}, hostC)
	var wg sync.WaitGroup
	for _, host := range opts.Hosts {
		select {
		case <-ctx.Done():
			goto collate
		case hostSem <- struct{}{}:
		}
		wg.Add(1)
		go func(host string) {
			defer wg.Done()
			defer func() { <-hostSem }()
			scanHost(ctx, host, opts.Ports, timeout, portC, report)
		}(host)
	}

collate:
	wg.Wait()

	sort.Slice(open, func(i, j int) bool {
		if open[i].Host != open[j].Host {
			return open[i].Host < open[j].Host
		}
		return open[i].Port < open[j].Port
	})

	items := make([]map[string]any, 0, len(open))
	for _, o := range open {
		items = append(items, map[string]any{
			"key":    fmt.Sprintf("%s:%d/tcp", o.Host, o.Port),
			"label":  fmt.Sprintf("%d/tcp", o.Port),
			"detail": strings.TrimSpace(fmt.Sprintf("%s  %s", o.Host, o.Service)),
		})
	}
	return Result{V: 1, Open: open, Items: items, Total: total}
}

func scanHost(ctx context.Context, host string, ports []int, timeout time.Duration, portC int, report func(PortResult)) {
	sem := make(chan struct{}, portC)
	var wg sync.WaitGroup
	for _, port := range ports {
		select {
		case <-ctx.Done():
			return
		case sem <- struct{}{}:
		}
		wg.Add(1)
		go func(port int) {
			defer wg.Done()
			defer func() { <-sem }()
			report(probe(ctx, host, port, timeout))
		}(port)
	}
	wg.Wait()
}

func probe(ctx context.Context, host string, port int, timeout time.Duration) PortResult {
	res := PortResult{Host: host, Port: port, Service: ServiceName(port)}
	d := net.Dialer{Timeout: timeout}
	c, err := d.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		if ne, ok := err.(net.Error); ok && ne.Timeout() {
			res.State = StateTimedOut
		} else {
			res.State = StateClosed
		}
		return res
	}
	_ = c.Close()
	res.State = StateOpen
	return res
}

// ParsePorts turns "22,80,443,8000-8010" into a sorted, de-duped []int.
func ParsePorts(spec string) ([]int, error) {
	set := map[int]struct{}{}
	for _, part := range strings.FieldsFunc(spec, func(r rune) bool { return r == ',' || r == ';' || r == ' ' }) {
		if lo, hi, ok := strings.Cut(part, "-"); ok {
			a, err1 := strconv.Atoi(strings.TrimSpace(lo))
			b, err2 := strconv.Atoi(strings.TrimSpace(hi))
			if err1 != nil || err2 != nil || a < 1 || b > 65535 || a > b {
				return nil, fmt.Errorf("invalid port range %q", part)
			}
			for p := a; p <= b; p++ {
				set[p] = struct{}{}
			}
			continue
		}
		p, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || p < 1 || p > 65535 {
			return nil, fmt.Errorf("invalid port %q", part)
		}
		set[p] = struct{}{}
	}
	out := make([]int, 0, len(set))
	for p := range set {
		out = append(out, p)
	}
	sort.Ints(out)
	return out, nil
}

func clamp(v, lo, hi, def int) int {
	if v == 0 {
		return def
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
