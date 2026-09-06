package monitor

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/tools/whois"
)

func init() { register(domainProbe{}) }

// domainProbe does a whois lookup and reports days until the registration
// expires. `value` = days to expiry. config: `warnDays` (default 30).
type domainProbe struct{}

func (domainProbe) Kind() string { return KindDomain }

// expiryLayouts covers the ISO-ish formats registrars actually emit.
var expiryLayouts = []string{
	time.RFC3339,
	"2006-01-02T15:04:05Z",
	"2006-01-02T15:04:05.000Z",
	"2006-01-02 15:04:05",
	"2006-01-02",
	"02-Jan-2006",
	"2006.01.02",
}

func (domainProbe) Probe(ctx context.Context, m Monitor) Sample {
	warn := m.cfgFloat("warnDays", 30)

	timeout := time.Duration(m.TimeoutSec) * time.Second
	if timeout < 15*time.Second {
		timeout = 15 * time.Second
	}

	done := make(chan Sample, 1)
	go func() {
		res, err := whois.Query(strings.TrimSpace(m.Target), timeout)
		if err != nil {
			done <- Sample{OK: false, Detail: errDetail("whois", err)}
			return
		}
		raw := strings.TrimSpace(res.Parsed.ExpirationDate)
		if raw == "" {
			done <- Sample{OK: false, Detail: "whois returned no expiration date"}
			return
		}
		exp, perr := parseExpiry(raw)
		if perr != nil {
			done <- Sample{OK: false, Detail: "unparseable expiry: " + raw}
			return
		}
		days := time.Until(exp).Hours() / 24
		round := float64(int(days*10)) / 10
		switch {
		case days < 0:
			done <- Sample{OK: false, Value: round, Detail: fmt.Sprintf("registration expired %.0f days ago", -days)}
		case days <= warn:
			done <- Sample{OK: false, Value: round, Detail: fmt.Sprintf("expires in %.0f days (warn ≤ %.0f)", days, warn)}
		default:
			done <- Sample{OK: true, Value: round, Detail: fmt.Sprintf("%.0f days to renewal", days)}
		}
	}()

	select {
	case s := <-done:
		return s
	case <-ctx.Done():
		return Sample{OK: false, Detail: "whois timed out"}
	}
}

func parseExpiry(s string) (time.Time, error) {
	for _, l := range expiryLayouts {
		if t, err := time.Parse(l, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("no layout matched %q", s)
}
