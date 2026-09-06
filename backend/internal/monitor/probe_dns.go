package monitor

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/tools/dnslookup"
)

func init() { register(dnsProbe{}) }

// dnsProbe resolves target and optionally checks the answer. `value` = resolve
// time in ms. config: recordType (A), resolver (host[:53]), expected [values].
// ok = resolves, and — when `expected` is set — every expected value is present.
type dnsProbe struct{}

func (dnsProbe) Kind() string { return KindDNS }

func (dnsProbe) Probe(ctx context.Context, m Monitor) Sample {
	rtype := strings.ToUpper(nz(m.cfgString("recordType"), "A"))
	expected := m.cfgStrings("expected")

	start := time.Now()
	res, err := dnslookup.Query(dnslookup.Options{
		Name:      strings.TrimSpace(m.Target),
		Types:     []string{rtype},
		Resolver:  m.cfgString("resolver"),
		Recursion: true,
		Timeout:   time.Duration(m.TimeoutSec) * time.Second,
	})
	elapsed := ms(time.Since(start))
	if err != nil {
		return Sample{OK: false, Value: elapsed, Detail: errDetail("dns", err)}
	}

	got := make([]string, 0, len(res.Records))
	for _, r := range res.Records {
		got = append(got, r.Value)
	}
	if len(got) == 0 {
		d := "no " + rtype + " record"
		if len(res.Errors) > 0 {
			d = strings.Join(res.Errors, "; ")
		}
		return Sample{OK: false, Value: elapsed, Detail: d}
	}

	if len(expected) > 0 {
		var missing []string
		for _, want := range expected {
			if !containsFold(got, want) {
				missing = append(missing, want)
			}
		}
		if len(missing) > 0 {
			return Sample{OK: false, Value: elapsed, Detail: fmt.Sprintf("missing %v (got %v)", missing, got)}
		}
	}
	return Sample{OK: true, Value: elapsed, Detail: fmt.Sprintf("%s → %s", rtype, strings.Join(got, ", "))}
}

func containsFold(hay []string, needle string) bool {
	for _, h := range hay {
		if strings.EqualFold(strings.TrimSuffix(h, "."), strings.TrimSuffix(needle, ".")) {
			return true
		}
	}
	return false
}
