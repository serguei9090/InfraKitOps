// Package wol sends a Wake-on-LAN magic packet. See NETWORK_MODULE_PLAN.md
// tool #16.
package wol

import (
	"fmt"
	"net"
	"regexp"
	"strings"
)

// RE2 has no backreferences, so this doesn't force a consistent separator;
// net.ParseMAC does the strict check after normalization.
var macRe = regexp.MustCompile(`^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$|^[0-9A-Fa-f]{12}$`)

// Result — shape "text".
type Result struct {
	V         int    `json:"v"`
	MAC       string `json:"mac"`
	Broadcast string `json:"broadcast"`
	Port      int    `json:"port"`
	BytesSent int    `json:"bytesSent"`
	Text      string `json:"text"`
}

// Send builds the 102-byte magic packet (6x 0xFF + MAC x16) and broadcasts it.
func Send(mac, broadcast string, port int) (Result, error) {
	mac = strings.TrimSpace(mac)
	if !macRe.MatchString(mac) {
		return Result{}, fmt.Errorf("%q is not a MAC address", mac)
	}
	hw, err := net.ParseMAC(normalizeMAC(mac))
	if err != nil {
		return Result{}, err
	}
	if broadcast == "" {
		broadcast = "255.255.255.255"
	}
	if port == 0 {
		port = 9
	}

	packet := make([]byte, 0, 102)
	for i := 0; i < 6; i++ {
		packet = append(packet, 0xFF)
	}
	for i := 0; i < 16; i++ {
		packet = append(packet, hw...)
	}

	addr := &net.UDPAddr{IP: net.ParseIP(broadcast), Port: port}
	if addr.IP == nil {
		return Result{}, fmt.Errorf("%q is not an IP address", broadcast)
	}
	conn, err := net.DialUDP("udp", nil, addr)
	if err != nil {
		return Result{}, err
	}
	defer conn.Close()

	n, err := conn.Write(packet)
	if err != nil {
		return Result{}, err
	}

	return Result{
		V:         1,
		MAC:       hw.String(),
		Broadcast: broadcast,
		Port:      port,
		BytesSent: n,
		Text:      fmt.Sprintf("Sent a %d-byte magic packet for %s to %s:%d", n, hw.String(), broadcast, port),
	}, nil
}

func normalizeMAC(mac string) string {
	mac = strings.ReplaceAll(mac, "-", ":")
	if !strings.Contains(mac, ":") && len(mac) == 12 {
		var b strings.Builder
		for i := 0; i < 12; i += 2 {
			if i > 0 {
				b.WriteByte(':')
			}
			b.WriteString(mac[i : i+2])
		}
		return b.String()
	}
	return mac
}
