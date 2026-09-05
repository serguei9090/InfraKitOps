//go:build !windows

package traceroute

import (
	"context"
	"net"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
)

// udpAvailable reports whether a raw ICMP listen socket can be opened — UDP
// path tracing needs to catch time-exceeded / port-unreachable ICMP errors
// from a raw socket, which needs CAP_NET_RAW or root (unlike the datagram-ICMP
// socket the plain ICMP mode uses, which Linux can grant unprivileged via
// net.ipv4.ping_group_range).
func udpAvailable() bool {
	conn, err := icmp.ListenPacket("ip4:icmp", "0.0.0.0")
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// supportedProtos: ICMP always; UDP when a raw ICMP listen socket is
// actually obtainable (root, or CAP_NET_RAW via setcap). TCP path tracing
// (T1b) is not wired.
func supportedProtos() []string {
	protos := []string{ProtoICMP}
	if udpAvailable() {
		protos = append(protos, ProtoUDP)
	}
	return protos
}

// probeHopImpl sends ICMP echoes with an explicit TTL over a datagram-ICMP
// socket (unprivileged on Linux when net.ipv4.ping_group_range covers the
// process GID; otherwise the package's setcap makes it privileged). It reads
// both the echo reply (destination reached) and time-exceeded messages
// (intermediate hop).
func probeHopImpl(ctx context.Context, cfg probeCfg) []HopProbe {
	if cfg.proto == ProtoUDP {
		return probeUDPHop(cfg)
	}
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

// probeUDPHop sends UDP datagrams to a (normally unlistened) high port with
// an explicit TTL and reads the ICMP error each hop sends back: a
// time-exceeded from an intermediate router, or a destination-unreachable
// (port unreachable) from the target itself once the packet actually
// arrives — the classic Unix traceroute signal for "reached". Needs a raw
// ICMP listen socket (root / CAP_NET_RAW); gated by udpAvailable() before
// Run() ever calls this.
func probeUDPHop(cfg probeCfg) []HopProbe {
	dest, ttl, count, timeout, port := cfg.dest, cfg.ttl, cfg.count, cfg.timeout, cfg.port
	out := make([]HopProbe, 0, count)

	icmpConn, err := icmp.ListenPacket("ip4:icmp", "0.0.0.0")
	if err != nil {
		for i := 0; i < count; i++ {
			out = append(out, HopProbe{TimedOut: true})
		}
		return out
	}
	defer icmpConn.Close()

	udpConn, err := net.ListenUDP("udp4", nil)
	if err != nil {
		for i := 0; i < count; i++ {
			out = append(out, HopProbe{TimedOut: true})
		}
		return out
	}
	defer udpConn.Close()
	_ = ipv4.NewPacketConn(udpConn).SetTTL(ttl)

	payload := []byte("infrakit-traceroute")
	buf := make([]byte, 1500)

	for seq := 0; seq < count; seq++ {
		start := time.Now()
		if _, err := udpConn.WriteToUDP(payload, &net.UDPAddr{IP: dest, Port: port}); err != nil {
			out = append(out, HopProbe{TimedOut: true})
			continue
		}
		_ = icmpConn.SetReadDeadline(time.Now().Add(timeout))

		n, peer, err := icmpConn.ReadFrom(buf)
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
		peerIP, _ := peer.(*net.IPAddr)
		addr := ""
		if peerIP != nil {
			addr = peerIP.IP.String()
		}
		switch parsed.Type {
		case ipv4.ICMPTypeTimeExceeded:
			out = append(out, HopProbe{RTT: rtt, Addr: addr})
		case ipv4.ICMPTypeDestinationUnreachable:
			out = append(out, HopProbe{RTT: rtt, Addr: addr, Reached: addr == dest.String()})
		default:
			out = append(out, HopProbe{TimedOut: true})
		}
	}
	return out
}
