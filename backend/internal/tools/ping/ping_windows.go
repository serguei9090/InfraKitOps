//go:build windows

package ping

import (
	"context"
	"encoding/binary"
	"fmt"
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

// icmpEchoReply mirrors the Win32 ICMP_ECHO_REPLY struct (x64 layout).
type icmpEchoReply struct {
	Address       uint32
	Status        uint32
	RoundTripTime uint32
	DataSize      uint16
	Reserved      uint16
	Data          uintptr
	OptTTL        uint8
	OptTOS        uint8
	OptFlags      uint8
	OptSize       uint8
	_pad          uint32
	OptData       uintptr
}

// echoImpl uses IcmpSendEcho, which does NOT require elevation on Windows.
func echoImpl(_ context.Context, host string, timeout time.Duration) (Reply, error) {
	ipaddr, err := net.ResolveIPAddr("ip4", host)
	if err != nil {
		return Reply{}, fmt.Errorf("resolve %s: %w", host, err)
	}
	v4 := ipaddr.IP.To4()
	if v4 == nil {
		return Reply{}, fmt.Errorf("%s has no IPv4 address (IPv6 ping not yet supported)", host)
	}

	h, _, _ := procIcmpCreate.Call()
	if h == 0 || h == uintptr(windows.InvalidHandle) {
		return Reply{}, fmt.Errorf("IcmpCreateFile failed")
	}
	defer procIcmpClose.Call(h)

	payload := []byte("infrakit-ping-monitor-0000000000")
	dest := binary.LittleEndian.Uint32(v4) // IcmpSendEcho wants the address in network order == the raw v4 bytes

	replySize := int(unsafe.Sizeof(icmpEchoReply{})) + len(payload) + 8
	reply := make([]byte, replySize)

	ms := uint32(timeout / time.Millisecond)
	if ms == 0 {
		ms = 1000
	}

	n, _, callErr := procIcmpSendEcho.Call(
		h,
		uintptr(dest),
		uintptr(unsafe.Pointer(&payload[0])),
		uintptr(uint16(len(payload))),
		0,
		uintptr(unsafe.Pointer(&reply[0])),
		uintptr(uint32(replySize)),
		uintptr(ms),
	)
	if n == 0 {
		return Reply{}, fmt.Errorf("no reply from %s (%v)", host, callErr)
	}

	r := (*icmpEchoReply)(unsafe.Pointer(&reply[0]))
	if r.Status != 0 {
		return Reply{}, fmt.Errorf("%s: ICMP status %d", host, r.Status)
	}
	var addr [4]byte
	binary.LittleEndian.PutUint32(addr[:], r.Address)
	return Reply{
		RTT:  time.Duration(r.RoundTripTime) * time.Millisecond,
		TTL:  int(r.OptTTL),
		Addr: net.IP(addr[:]).String(),
	}, nil
}
