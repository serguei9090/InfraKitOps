//go:build windows

package traceroute

import (
	"context"
	"encoding/binary"
	"net"
	"time"
	"unsafe"

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

// supportedProtos: Windows has no unprivileged raw sockets and IcmpSendEcho is
// ICMP-only, so UDP/TCP path tracing isn't offered here yet.
func supportedProtos() []string { return []string{ProtoICMP} }

// probeHopImpl uses IcmpSendEcho with an explicit TTL — unprivileged on Windows.
// A TTL-expired reply still returns the responding router's address.
func probeHopImpl(_ context.Context, cfg probeCfg) []HopProbe {
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
