package lldp

import (
	"encoding/binary"
	"net"
)

// CDP TLV types.
const (
	cdpDeviceID     = 0x0001
	cdpAddresses    = 0x0002
	cdpPortID       = 0x0003
	cdpCapabilities = 0x0004
	cdpSoftwareVer  = 0x0005
	cdpPlatform     = 0x0006
	cdpNativeVLAN   = 0x000a
)

// parseCDPFromLLC expects the bytes after the 802.3 length field:
// LLC AA AA 03, SNAP OUI 00 00 0C, PID 20 00, then the CDP payload.
func parseCDPFromLLC(b []byte) (*Neighbor, error) {
	if len(b) < 8 {
		return nil, nil
	}
	if !(b[0] == 0xaa && b[1] == 0xaa && b[2] == 0x03 &&
		b[3] == 0x00 && b[4] == 0x00 && b[5] == 0x0c &&
		b[6] == 0x20 && b[7] == 0x00) {
		return nil, nil
	}
	return ParseCDP(b[8:])
}

// ParseCDP decodes a CDP payload: version(1) ttl(1) checksum(2), then TLVs of
// type(2) length(2) value — length includes the 4-byte TLV header.
func ParseCDP(b []byte) (*Neighbor, error) {
	if len(b) < 4 {
		return nil, nil
	}
	n := &Neighbor{Protocol: "cdp", TTL: int(b[1])}
	i := 4
	for i+4 <= len(b) {
		typ := binary.BigEndian.Uint16(b[i : i+2])
		ln := int(binary.BigEndian.Uint16(b[i+2 : i+4]))
		if ln < 4 || i+ln > len(b) {
			break
		}
		v := b[i+4 : i+ln]
		i += ln

		switch typ {
		case cdpDeviceID:
			n.SystemName = cleanStr(v)
			n.ChassisID = cleanStr(v)
		case cdpPortID:
			n.PortID = cleanStr(v)
			n.PortDesc = cleanStr(v)
		case cdpPlatform:
			n.Platform = cleanStr(v)
		case cdpSoftwareVer:
			n.SoftwareVer = cleanStr(v)
		case cdpNativeVLAN:
			if len(v) >= 2 {
				n.NativeVLAN = int(binary.BigEndian.Uint16(v))
			}
		case cdpCapabilities:
			n.Capabilities = decodeCDPCaps(v)
		case cdpAddresses:
			n.MgmtAddrs = append(n.MgmtAddrs, decodeCDPAddrs(v)...)
		}
	}
	return n, nil
}

var cdpCaps = []struct {
	bit  uint32
	name string
}{
	{0x01, "Router"},
	{0x02, "TransparentBridge"},
	{0x04, "SourceRouteBridge"},
	{0x08, "Switch"},
	{0x10, "Host"},
	{0x20, "IGMP"},
	{0x40, "Repeater"},
}

func decodeCDPCaps(v []byte) []string {
	if len(v) < 4 {
		return nil
	}
	f := binary.BigEndian.Uint32(v)
	var out []string
	for _, c := range cdpCaps {
		if f&c.bit != 0 {
			out = append(out, c.name)
		}
	}
	return out
}

// decodeCDPAddrs: count(4), then per address: protoType(1) protoLen(1) proto(protoLen) addrLen(2) addr(addrLen).
func decodeCDPAddrs(v []byte) []string {
	if len(v) < 4 {
		return nil
	}
	count := int(binary.BigEndian.Uint32(v))
	i := 4
	var out []string
	for a := 0; a < count && i+2 <= len(v); a++ {
		protoLen := int(v[i+1])
		i += 2 + protoLen
		if i+2 > len(v) {
			break
		}
		addrLen := int(binary.BigEndian.Uint16(v[i : i+2]))
		i += 2
		if i+addrLen > len(v) {
			break
		}
		addr := v[i : i+addrLen]
		i += addrLen
		if addrLen == 4 || addrLen == 16 {
			out = append(out, net.IP(addr).String())
		}
	}
	return out
}
