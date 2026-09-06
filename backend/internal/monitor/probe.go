package monitor

import (
	"context"
	"fmt"
	"time"
)

// Probe runs one check for a monitor kind. Implementations must respect ctx
// (which carries the monitor's timeout) and never block past it.
type Probe interface {
	Kind() string
	Probe(ctx context.Context, m Monitor) Sample
}

var probes = map[string]Probe{}

func register(p Probe) { probes[p.Kind()] = p }

// probeFor returns the Probe for a kind, or nil.
func probeFor(kind string) Probe { return probes[kind] }

// SupportedKinds lists the probe kinds this build can run.
func SupportedKinds() []string {
	out := make([]string, 0, len(probes))
	for k := range probes {
		out = append(out, k)
	}
	return out
}

// KnownKind reports whether a probe is registered for kind.
func KnownKind(kind string) bool { return probes[kind] != nil }

// runProbe executes m's probe under its timeout and stamps the sample time.
func runProbe(ctx context.Context, m Monitor) Sample {
	p := probeFor(m.Kind)
	if p == nil {
		return Sample{T: time.Now().UnixMilli(), OK: false, Detail: "unsupported monitor kind: " + m.Kind}
	}
	pctx, cancel := context.WithTimeout(ctx, time.Duration(m.TimeoutSec)*time.Second)
	defer cancel()
	s := p.Probe(pctx, m)
	s.T = time.Now().UnixMilli()
	return s
}

func ms(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }

func errDetail(prefix string, err error) string { return fmt.Sprintf("%s: %v", prefix, err) }
