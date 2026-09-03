//go:build !windows

package traceroute

import (
	"context"
	"net"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
)

// supportedProtos: UDP/TCP path tracing (T1b) needs a raw ICMP listen socket
// (CAP_NET_RAW) and isn't wired yet — ICMP only for now on every platform.
func supportedProtos() []string { return []string{ProtoICMP} }

// probeHopImpl sends ICMP echoes with an explicit TTL over a datagram-ICMP
// socket (unprivileged on Linux when net.ipv4.ping_group_range covers the
// process GID; otherwise the package's setcap makes it privileged). It reads
// both the echo reply (destination reached) and time-exceeded messages
// (intermediate hop).
func probeHopImpl(ctx context.Context, cfg probeCfg) []HopProbe {
	dest, ttl, count, timeout := cfg.dest, cfg.ttl, cfg.count, cfg.timeout
	out := make([]HopProbe, 0, count)

	conn, err := icmp.ListenPacket("udp4", "0.0.0.0")
	if err != nil {
		for i := 0; i < count; i++ {
			out = append(out, HopProbe{TimedOut: true})
		}
		return out
	}
	defer conn.Close()
	_ = conn.IPv4PacketConn().SetTTL(ttl)

	for seq := 0; seq < count; seq++ {
		msg := icmp.Message{
			Type: ipv4.ICMPTypeEcho, Code: 0,
			Body: &icmp.Echo{ID: 0xffff & (ttl<<8 | seq), Seq: seq, Data: []byte("infrakit-traceroute")},
		}
		b, _ := msg.Marshal(nil)

		start := time.Now()
		if _, err := conn.WriteTo(b, &net.UDPAddr{IP: dest}); err != nil {
			out = append(out, HopProbe{TimedOut: true})
			continue
		}
		_ = conn.SetReadDeadline(time.Now().Add(timeout))

		buf := make([]byte, 1500)
		n, peer, err := conn.ReadFrom(buf)
		if err != nil {
			out = append(out, HopProbe{TimedOut: true})
			continue
		}
		rtt := time.Since(start)
		parsed, perr := icmp.ParseMessage(1, buf[:n])
		if perr != nil {
			out = append(out, HopProbe{TimedOut: true})
			continue
		}
		peerIP := peer.(*net.UDPAddr).IP.String()
		switch parsed.Type {
		case ipv4.ICMPTypeEchoReply:
			out = append(out, HopProbe{RTT: rtt, Addr: peerIP, Reached: true})
		case ipv4.ICMPTypeTimeExceeded:
			out = append(out, HopProbe{RTT: rtt, Addr: peerIP})
		default:
			out = append(out, HopProbe{TimedOut: true})
		}
		_ = ctx
	}
	return out
}
