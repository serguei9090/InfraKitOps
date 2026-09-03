package lldp

import (
	"bytes"
	"encoding/binary"
	"testing"
)

// lldpTLV packs an LLDP TLV (7-bit type, 9-bit length).
func lldpTLV(typ int, val []byte) []byte {
	h := uint16(typ)<<9 | uint16(len(val))&0x1FF
	b := make([]byte, 2+len(val))
	binary.BigEndian.PutUint16(b[0:2], h)
	copy(b[2:], val)
	return b
}

func eth(dst [6]byte, ethertype uint16, payload []byte) []byte {
	f := make([]byte, 14+len(payload))
	copy(f[0:6], dst[:])
	copy(f[6:12], []byte{0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff})
	binary.BigEndian.PutUint16(f[12:14], ethertype)
	copy(f[14:], payload)
	return f
}

func TestParseLLDP(t *testing.T) {
	var du bytes.Buffer
	du.Write(lldpTLV(1, append([]byte{4}, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55))) // chassis: MAC
	du.Write(lldpTLV(2, append([]byte{5}, []byte("Gi1/0/24")...)))              // port: ifname
	du.Write(lldpTLV(3, []byte{0x00, 0x78}))                                    // TTL 120
	du.Write(lldpTLV(4, []byte("uplink to core")))                              // port desc
	du.Write(lldpTLV(5, []byte("access-sw-3")))                                 // system name
	du.Write(lldpTLV(6, []byte("Cisco IOS")))                                   // system desc
	du.Write(lldpTLV(7, []byte{0x00, 0x04, 0x00, 0x04}))                        // caps: Bridge enabled
	du.Write(lldpTLV(8, []byte{5, 1, 10, 0, 0, 5, 2, 0, 0, 0, 1, 0}))           // mgmt addr 10.0.0.5
	du.Write(lldpTLV(127, []byte{0x00, 0x80, 0xc2, 0x01, 0x00, 0x0a}))          // 802.1 port VLAN 10
	du.Write(lldpTLV(0, nil))                                                   // end

	n, err := ParseEthernet(eth([6]byte{0x01, 0x80, 0xc2, 0, 0, 0x0e}, EtherTypeLLDP, du.Bytes()))
	if err != nil || n == nil {
		t.Fatalf("parse: %v / %v", n, err)
	}
	if n.Protocol != "lldp" {
		t.Errorf("protocol = %q", n.Protocol)
	}
	if n.ChassisID != "00:11:22:33:44:55" {
		t.Errorf("chassisId = %q", n.ChassisID)
	}
	if n.PortID != "Gi1/0/24" {
		t.Errorf("portId = %q", n.PortID)
	}
	if n.TTL != 120 {
		t.Errorf("ttl = %d", n.TTL)
	}
	if n.SystemName != "access-sw-3" || n.PortDesc != "uplink to core" || n.SystemDesc != "Cisco IOS" {
		t.Errorf("strings: name=%q portDesc=%q sysDesc=%q", n.SystemName, n.PortDesc, n.SystemDesc)
	}
	if len(n.Capabilities) != 1 || n.Capabilities[0] != "Bridge" {
		t.Errorf("caps = %v", n.Capabilities)
	}
	if len(n.MgmtAddrs) != 1 || n.MgmtAddrs[0] != "10.0.0.5" {
		t.Errorf("mgmtAddrs = %v", n.MgmtAddrs)
	}
	if n.NativeVLAN != 10 {
		t.Errorf("nativeVlan = %d", n.NativeVLAN)
	}
	if n.Key() == "" {
		t.Error("empty key")
	}
}

func TestParseLLDPTruncated(t *testing.T) {
	// a TLV claiming more length than the buffer holds must not panic
	bad := []byte{0x02, 0xff, 0x01, 0x02}
	if _, err := ParseLLDP(bad); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
}

func TestParseEthernetIgnoresOther(t *testing.T) {
	n, err := ParseEthernet(eth([6]byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff}, 0x0800, []byte("ip packet")))
	if err != nil || n != nil {
		t.Errorf("IP frame should be ignored, got %v / %v", n, err)
	}
}

// cdpTLV packs a CDP TLV (type 2, length 2 — length covers the 4-byte header).
func cdpTLV(typ uint16, val []byte) []byte {
	b := make([]byte, 4+len(val))
	binary.BigEndian.PutUint16(b[0:2], typ)
	binary.BigEndian.PutUint16(b[2:4], uint16(4+len(val)))
	copy(b[4:], val)
	return b
}

func TestParseCDP(t *testing.T) {
	var p bytes.Buffer
	p.Write([]byte{0x02, 0xb4, 0x00, 0x00}) // version 2, ttl 180, checksum
	p.Write(cdpTLV(cdpDeviceID, []byte("core-switch.example")))
	p.Write(cdpTLV(cdpPortID, []byte("GigabitEthernet1/0/1")))
	p.Write(cdpTLV(cdpPlatform, []byte("cisco WS-C3850")))
	p.Write(cdpTLV(cdpNativeVLAN, []byte{0x00, 0x64})) // 100
	p.Write(cdpTLV(cdpCapabilities, []byte{0x00, 0x00, 0x00, 0x28}))

	// LLC/SNAP wrapper + 802.3 length-encoded ethertype
	llc := append([]byte{0xaa, 0xaa, 0x03, 0x00, 0x00, 0x0c, 0x20, 0x00}, p.Bytes()...)
	frame := eth([6]byte{0x01, 0x00, 0x0c, 0xcc, 0xcc, 0xcc}, uint16(len(llc)), llc)

	n, err := ParseEthernet(frame)
	if err != nil || n == nil {
		t.Fatalf("parse: %v / %v", n, err)
	}
	if n.Protocol != "cdp" || n.SystemName != "core-switch.example" {
		t.Errorf("protocol/name: %q / %q", n.Protocol, n.SystemName)
	}
	if n.PortID != "GigabitEthernet1/0/1" || n.Platform != "cisco WS-C3850" {
		t.Errorf("portId/platform: %q / %q", n.PortID, n.Platform)
	}
	if n.NativeVLAN != 100 {
		t.Errorf("nativeVlan = %d", n.NativeVLAN)
	}
	if n.TTL != 180 {
		t.Errorf("ttl = %d", n.TTL)
	}
	// 0x28 = Switch(0x08) | IGMP(0x20)
	want := map[string]bool{"Switch": true, "IGMP": true}
	for _, c := range n.Capabilities {
		if !want[c] {
			t.Errorf("unexpected cap %q", c)
		}
		delete(want, c)
	}
	if len(want) != 0 {
		t.Errorf("missing caps %v", want)
	}
}

func TestReadPcapngFrames(t *testing.T) {
	// hand-build a tiny little-endian pcapng: SHB + IDB(if_name="eth0") + EPB(frame)
	le := binary.LittleEndian
	block := func(typ uint32, body []byte) []byte {
		for len(body)%4 != 0 {
			body = append(body, 0)
		}
		total := uint32(12 + len(body))
		b := make([]byte, 0, total)
		var h [4]byte
		le.PutUint32(h[:], typ)
		b = append(b, h[:]...)
		le.PutUint32(h[:], total)
		b = append(b, h[:]...)
		b = append(b, body...)
		le.PutUint32(h[:], total)
		b = append(b, h[:]...)
		return b
	}

	shbBody := make([]byte, 16)
	le.PutUint32(shbBody[0:4], 0x1A2B3C4D)
	le.PutUint16(shbBody[4:6], 1)
	le.PutUint16(shbBody[6:8], 0)
	// section length -1
	for i := 8; i < 16; i++ {
		shbBody[i] = 0xff
	}

	idbBody := []byte{1, 0, 0, 0, 0, 0, 0, 0} // linktype EN10MB, snaplen 0
	// option if_name (code 2)
	idbBody = append(idbBody, 2, 0, 4, 0)
	idbBody = append(idbBody, []byte("eth0")...)
	idbBody = append(idbBody, 0, 0, 0, 0) // opt_endofopt

	pkt := []byte("hello-frame-bytes")
	epbBody := make([]byte, 20)
	le.PutUint32(epbBody[12:16], uint32(len(pkt)))
	le.PutUint32(epbBody[16:20], uint32(len(pkt)))
	epbBody = append(epbBody, pkt...)

	var buf bytes.Buffer
	buf.Write(block(0x0A0D0D0A, shbBody))
	buf.Write(block(0x00000001, idbBody))
	buf.Write(block(0x00000006, epbBody))

	var gotIface string
	var gotData []byte
	if err := ReadPcapngFrames(&buf, func(iface string, data []byte) {
		gotIface, gotData = iface, data
	}); err != nil {
		t.Fatalf("read: %v", err)
	}
	if gotIface != "eth0" {
		t.Errorf("iface = %q, want eth0", gotIface)
	}
	if string(gotData) != string(pkt) {
		t.Errorf("frame = %q, want %q", gotData, pkt)
	}
}
