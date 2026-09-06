package monitor

import (
	"context"
	"net"
	"strings"
	"time"
)

func init() { register(tcpProbe{}) }

// tcpProbe opens a TCP connection to target (host:port). value = connect ms.
type tcpProbe struct{}

func (tcpProbe) Kind() string { return KindTCP }

func (tcpProbe) Probe(ctx context.Context, m Monitor) Sample {
	addr := strings.TrimSpace(m.Target)
	if !strings.Contains(addr, ":") {
		return Sample{OK: false, Detail: "target must be host:port"}
	}
	start := time.Now()
	d := net.Dialer{Timeout: time.Duration(m.TimeoutSec) * time.Second}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return Sample{OK: false, Detail: errDetail("dial", err)}
	}
	_ = conn.Close()
	return Sample{OK: true, Value: ms(time.Since(start))}
}
