package monitor

import (
	"context"
	"time"

	"github.com/infrakit/backend/internal/tools/ping"
)

func init() { register(icmpProbe{}) }

// icmpProbe sends one ICMP echo. value = RTT in ms.
type icmpProbe struct{}

func (icmpProbe) Kind() string { return KindICMP }

func (icmpProbe) Probe(ctx context.Context, m Monitor) Sample {
	timeout := time.Duration(m.TimeoutSec) * time.Second
	rep, err := ping.Echo(ctx, m.Target, timeout)
	if err != nil {
		return Sample{OK: false, Detail: errDetail("ping", err)}
	}
	return Sample{OK: true, Value: ms(rep.RTT), Detail: rep.Addr}
}
