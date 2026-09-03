// Package lldp captures and decodes LLDP (IEEE 802.1AB) and Cisco CDP neighbor
// advertisements so the Discovery Protocol tool can show which switch / port /
// VLAN a NIC is plugged into. See DISCOVERY_PROTOCOL_PLAN.md.
//
// Capture is OS-specific (pktmon on Windows, lldpctl / AF_PACKET on Linux) and
// lives in engine_*.go. This file is the pure frame decoder — no I/O, unit
// tested against hand-built frames.
package lldp

import (
	"encoding/binary"
	"fmt"
	"net"
	"strings"
)

// EtherTypeLLDP is the LLDP ethertype (used as a pktmon / BPF filter).
const EtherTypeLLDP = 0x88CC

// CDPMulticast is the destination MAC every CDP frame uses.
var CDPMulticast = net.HardwareAddr{0x01, 0x00, 0x0c, 0xcc, 0xcc, 0xcc}

// Neighbor is one decoded advertisement.
type Neighbor struct {
	Iface        string   `json:"iface"`    // local NIC it arrived on
	Protocol     string   `json:"protocol"` // "lldp" | "cdp"
	SystemName   string   `json:"systemName,omitempty"`
	SystemDesc   string   `json:"systemDesc,omitempty"`
	ChassisID    string   `json:"chassisId,omitempty"`
	PortID       string   `json:"portId,omitempty"`
	PortDesc     string   `json:"portDesc,omitempty"`
	Platform     string   `json:"platform,omitempty"`
	SoftwareVer  string   `json:"softwareVersion,omitempty"`
	NativeVLAN   int      `json:"nativeVlan,omitempty"`
	MgmtAddrs    []string `json:"mgmtAddrs,omitempty"`
	Capabilities []string `json:"capabilities,omitempty"`
	TTL          int      `json:"ttl,omitempty"`
	SeenAt       int64    `json:"seenAt,omitempty"`
}

// Key identifies a neighbor for dedup across a capture window.
func (n Neighbor) Key() string {
	return n.Iface + "|" + n.Protocol + "|" + n.ChassisID + "|" + n.PortID
}

// ParseEthernet decodes one full Ethernet frame, dispatching to the LLDP or CDP
// decoder. Returns nil (no error) for a frame that is neither.
func ParseEthernet(frame []byte) (*Neighbor, error) {
	if len(frame) < 14 {
		return nil, nil
	}
	dst := net.HardwareAddr(frame[0:6])
	etherType := binary.BigEndian.Uint16(frame[12:14])

	switch {
	case etherType == EtherTypeLLDP:
		return ParseLLDP(frame[14:])
	case etherType <= 1500 && macEqual(dst, CDPMulticast):
		// 802.3 length-encoded: LLC (AA AA 03) + SNAP OUI 00-00-0C + PID 2000
		return parseCDPFromLLC(frame[14:])
	default:
		return nil, nil
	}
}

func macEqual(a, b net.HardwareAddr) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// ParseLLDP decodes an LLDPDU (the bytes after the ethertype).
func ParseLLDP(b []byte) (*Neighbor, error) {
	n := &Neighbor{Protocol: "lldp"}
	i := 0
	for i+2 <= len(b) {
		hdr := binary.BigEndian.Uint16(b[i : i+2])
		typ := hdr >> 9
		ln := int(hdr & 0x1FF)
		i += 2
		if i+ln > len(b) {
			break
		}
		v := b[i : i+ln]
		i += ln

		switch typ {
		case 0: // End of LLDPDU
			return n, nil
		case 1:
			n.ChassisID = decodeChassisPortID(v)
		case 2:
			n.PortID = decodeChassisPortID(v)
		case 3:
			if len(v) >= 2 {
				n.TTL = int(binary.BigEndian.Uint16(v))
			}
		case 4:
			n.PortDesc = cleanStr(v)
		case 5:
			n.SystemName = cleanStr(v)
		case 6:
			n.SystemDesc = cleanStr(v)
		case 7:
			n.Capabilities = decodeCaps(v)
		case 8:
			if a := decodeMgmtAddr(v); a != "" {
				n.MgmtAddrs = append(n.MgmtAddrs, a)
			}
		case 127:
			decodeOrgTLV(n, v)
		}
	}
	return n, nil
}

// decodeChassisPortID reads the subtype byte then renders the id.
func decodeChassisPortID(v []byte) string {
	if len(v) < 2 {
		return ""
	}
	sub, data := v[0], v[1:]
	switch sub {
	case 4: // MAC address
		if len(data) == 6 {
			return net.HardwareAddr(data).String()
		}
	case 5: // network address
		if len(data) == 5 && data[0] == 1 { // IPv4
			return net.IP(data[1:]).String()
		}
		if len(data) == 17 && data[0] == 2 { // IPv6
			return net.IP(data[1:]).String()
		}
	}
	if printable(data) {
		return cleanStr(data)
	}
	return hexColon(data)
}

var lldpCaps = []struct {
	bit  uint16
	name string
}{
	{1 << 0, "Other"},
	{1 << 1, "Repeater"},
	{1 << 2, "Bridge"},
	{1 << 3, "WLAN-AP"},
	{1 << 4, "Router"},
	{1 << 5, "Telephone"},
	{1 << 6, "DOCSIS"},
	{1 << 7, "Station"},
	{1 << 8, "C-VLAN"},
	{1 << 9, "S-VLAN"},
	{1 << 10, "TPMR"},
}

func decodeCaps(v []byte) []string {
	if len(v) < 4 {
		return nil
	}
	enabled := binary.BigEndian.Uint16(v[2:4]) // second word = enabled caps
	var out []string
	for _, c := range lldpCaps {
		if enabled&c.bit != 0 {
			out = append(out, c.name)
		}
	}
	return out
}

// decodeMgmtAddr: addrLen(1) addrSubtype(1) addr(addrLen-1) ifSubtype(1) ifNum(4) oidLen(1) oid...
func decodeMgmtAddr(v []byte) string {
	if len(v) < 2 {
		return ""
	}
	addrLen := int(v[0])
	if addrLen < 2 || 1+addrLen > len(v) {
		return ""
	}
	subtype := v[1]
	addr := v[2 : 1+addrLen]
	switch subtype {
	case 1: // IPv4
		if len(addr) == 4 {
			return net.IP(addr).String()
		}
	case 2: // IPv6
		if len(addr) == 16 {
			return net.IP(addr).String()
		}
	}
	return ""
}

func decodeOrgTLV(n *Neighbor, v []byte) {
	if len(v) < 4 {
		return
	}
	oui := [3]byte{v[0], v[1], v[2]}
	sub := v[3]
	data := v[4:]
	switch oui {
	case [3]byte{0x00, 0x80, 0xc2}: // IEEE 802.1
		switch sub {
		case 1: // Port VLAN ID
			if len(data) >= 2 {
				n.NativeVLAN = int(binary.BigEndian.Uint16(data))
			}
		}
	case [3]byte{0x00, 0x12, 0x0f}: // IEEE 802.3 — MAC/PHY, link agg, max frame (not surfaced yet)
	}
}

// --- small string helpers ---

func cleanStr(b []byte) string {
	return strings.TrimRight(strings.Map(func(r rune) rune {
		if r == 0 {
			return -1
		}
		return r
	}, string(b)), " \t\r\n")
}

func printable(b []byte) bool {
	if len(b) == 0 {
		return false
	}
	for _, c := range b {
		if c < 0x20 || c > 0x7e {
			return false
		}
	}
	return true
}

func hexColon(b []byte) string {
	parts := make([]string, len(b))
	for i, c := range b {
		parts[i] = fmt.Sprintf("%02x", c)
	}
	return strings.Join(parts, ":")
}
