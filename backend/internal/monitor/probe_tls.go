package monitor

import (
	"context"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"time"

	"github.com/infrakit/backend/internal/tools/x509fetch"
)

func init() { register(tlsProbe{}) }

// tlsProbe dials target (host or host:port, :443 assumed), verifies the chain
// against system roots + hostname, and reports days until the leaf expires.
// `value` = days to expiry (negative once expired). config: `warnDays` (default 21).
type tlsProbe struct{}

func (tlsProbe) Kind() string { return KindTLS }

func (tlsProbe) Probe(ctx context.Context, m Monitor) Sample {
	warn := m.cfgFloat("warnDays", 21)

	res, err := x509fetch.Fetch(ctx, m.Target)
	if err != nil {
		return Sample{OK: false, Detail: errDetail("tls", err)}
	}

	block, _ := pem.Decode([]byte(res.PEM))
	if block == nil {
		return Sample{OK: false, Detail: "no certificate in response"}
	}
	leaf, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return Sample{OK: false, Detail: errDetail("parse cert", err)}
	}

	days := time.Until(leaf.NotAfter).Hours() / 24
	round := float64(int(days*10)) / 10

	switch {
	case days < 0:
		return Sample{OK: false, Value: round, Detail: fmt.Sprintf("expired %.0f days ago (%s)", -days, res.ServerName)}
	case !res.Trusted:
		return Sample{OK: false, Value: round, Detail: nz(res.VerifyError, "chain not trusted")}
	case days <= warn:
		return Sample{OK: false, Value: round, Detail: fmt.Sprintf("expires in %.1f days (warn ≤ %.0f)", days, warn)}
	default:
		return Sample{OK: true, Value: round, Detail: fmt.Sprintf("valid, %.0f days left", days)}
	}
}

func nz(s, def string) string {
	if s == "" {
		return def
	}
	return s
}
