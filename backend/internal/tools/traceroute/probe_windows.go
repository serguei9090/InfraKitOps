//go:build windows

package traceroute

import (
	"context"
	"encoding/binary"
	"net"
	"time"
	"unsafe"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
	"golang.org/x/sys/windows"
)

var (
	iphlpapi         = windows.NewLazySystemDLL("iphlpapi.dll")
	procIcmpCreate   = iphlpapi.NewProc("IcmpCreateFile")
	procIcmpClose    = iphlpapi.NewProc("IcmpCloseHandle")
	procIcmpSendEcho = iphlpapi.NewProc("IcmpSendEcho")
)

// ipOptionInformation is the Win32 IP_OPTION_INFORMATION (x64: pointer-sized last field).
type ipOptionInformation struct {
	TTL         uint8
	TOS         uint8
	Flags       uint8
	OptionsSize uint8
	_pad        uint32
	OptionsData uintptr
}

type icmpEchoReply struct {
	Address       uint32
	Status        uint32
	RoundTripTime uint32
	DataSize      uint16
	Reserved      uint16
	Data          uintptr
	Options       ipOptionInformation
}

const (
	ipSuccess           = 0
	ipTTLExpiredTransit = 11013
	ipTTLExpiredReassem = 11014
)

// udpAvailable reports whether a raw ICMP listen socket can be opened. UDP
// path tracing needs one to catch time-exceeded / port-unreachable replies;
// Windows restricts raw sockets to an elevated (Administrator) process —
// IcmpSendEcho's unprivileged path is ICMP-only and can't be reused for this.
func udpAvailable() bool {
	conn, err := icmp.ListenPacket("ip4:icmp", "0.0.0.0")
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// supportedProtos: ICMP always (IcmpSendEcho, unprivileged); UDP only when
// running elevated (raw ICMP listen socket). TCP path tracing (T1b) is not
// offered — Windows has blocked raw TCP segment construction since XP SP2,
// so a real per-hop SYN trace needs a packet-crafting driver this project's
// license policy already excludes (Npcap).
func supportedProtos() []string {
	protos := []string{ProtoICMP}
	if udpAvailable() {
		protos = append(protos, ProtoUDP)
	}
	return protos
}

// probeHopImpl uses IcmpSendEcho with an explicit TTL — unprivileged on Windows.
// A TTL-expired reply still returns the responding router's address.
func probeHopImpl(_ context.Context, cfg probeCfg) []HopProbe {
	if cfg.proto == ProtoUDP {
		return probeUDPHop(cfg)
	}
	dest, ttl, count, timeout := cfg.dest, cfg.ttl, cfg.count, cfg.timeout
	out := make([]HopProbe, 0, count)

	h, _, _ := procIcmpCreate.Call()
	if h == 0 || h == uintptr(windows.InvalidHandle) {
		for i := 0; i < count; i++ {
			out = append(out, HopProbe{TimedOut: true})
		}
		return out
	}
	defer procIcmpClose.Call(h)

	v4 := dest.To4()
	destAddr := binary.LittleEndian.Uint32(v4)
	payload := []byte("infrakit-traceroute-000000000000")
	opts := ipOptionInformation{TTL: uint8(ttl)}
	ms := uint32(timeout / time.Millisecond)
	if ms == 0 {
		ms = 1000
	}
	replySize := int(unsafe.Sizeof(icmpEchoReply{})) + len(payload) + 8
	reply := make([]byte, replySize)

	for i := 0; i < count; i++ {
		n, _, _ := procIcmpSendEcho.Call(
			h,
			uintptr(destAddr),
			uintptr(unsafe.Pointer(&payload[0])),
			uintptr(uint16(len(payload))),
			uintptr(unsafe.Pointer(&opts)),
			uintptr(unsafe.Pointer(&reply[0])),
			uintptr(uint32(replySize)),
			uintptr(ms),
		)
		if n == 0 {
			out = append(out, HopProbe{TimedOut: true})
			continue
		}
		r := (*icmpEchoReply)(unsafe.Pointer(&reply[0]))
		var addr [4]byte
		binary.LittleEndian.PutUint32(addr[:], r.Address)
		hp := HopProbe{
			RTT:  time.Duration(r.RoundTripTime) * time.Millisecond,
			Addr: net.IP(addr[:]).String(),
		}
		switch r.Status {
		case ipSuccess:
			hp.Reached = true
		case ipTTLExpiredTransit, ipTTLExpiredReassem:
			// intermediate hop — addr is the router
		default:
			hp.TimedOut = true
			hp.Addr = ""
		}
		out = append(out, hp)
	}
	return out
}

// probeUDPHop sends UDP datagrams to a (normally unlistened) high port with
// an explicit TTL and reads the ICMP error each hop sends back: a
// time-exceeded from an intermediate router, or a destination-unreachable
// (port unreachable) from the target itself once the packet actually
// arrives. Needs a raw ICMP listen socket, i.e. an elevated process; gated
// by udpAvailable() before Run() ever calls this.
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
