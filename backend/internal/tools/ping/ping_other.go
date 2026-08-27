//go:build !windows

package ping

import (
	"context"
	"fmt"
	"time"

	probing "github.com/prometheus-community/pro-bing"
)

// echoImpl uses pro-bing in unprivileged (UDP datagram) mode. On Linux this
// works when net.ipv4.ping_group_range covers the process GID; otherwise the
// package post-install sets CAP_NET_RAW and privileged mode is used instead.
func echoImpl(ctx context.Context, host string, timeout time.Duration) (Reply, error) {
	p, err := probing.NewPinger(host)
	if err != nil {
		return Reply{}, err
	}
	p.Count = 1
	p.Timeout = timeout
	p.SetPrivileged(false)

	var reply Reply
	var got bool
	p.OnRecv = func(pkt *probing.Packet) {
		reply = Reply{RTT: pkt.Rtt, TTL: pkt.TTL, Addr: pkt.IPAddr.String()}
		got = true
	}

	done := make(chan error, 1)
	go func() { done <- p.Run() }()
	select {
	case <-ctx.Done():
		p.Stop()
		return Reply{}, ctx.Err()
	case err := <-done:
		if err != nil {
			return Reply{}, err
		}
	}
	if !got {
		return Reply{}, fmt.Errorf("no reply from %s", host)
	}
	return reply, nil
}
