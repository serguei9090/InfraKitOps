//go:build windows

package neighbor

import (
	"os/exec"
	"regexp"
	"strings"
)

var (
	ifaceLine = regexp.MustCompile(`^Interface:\s+(\S+)`)
	rowLine   = regexp.MustCompile(`^\s*([0-9a-fA-F:.]+)\s+([0-9a-fA-F-]{11,17})\s+(\w+)`)
)

// listImpl parses `arp -a`. A GetIpNetTable2 P/Invoke (richer state, IPv6/NDP)
// is a later upgrade — see NETWORK_MODULE_PLAN.md tool #12.
func listImpl() ([]Entry, error) {
	out, err := exec.Command("arp", "-a").Output()
	if err != nil {
		return nil, err
	}
	var entries []Entry
	iface := ""
	for _, line := range strings.Split(string(out), "\n") {
		if m := ifaceLine.FindStringSubmatch(line); m != nil {
			iface = m[1]
			continue
		}
		m := rowLine.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		ip, mac, kind := m[1], normalizeMAC(m[2]), strings.ToLower(m[3])
		if mac == "" || strings.HasPrefix(mac, "ff:ff:ff") {
			continue
		}
		entries = append(entries, Entry{
			IP:        ip,
			MAC:       mac,
			Interface: iface,
			State:     kind, // "dynamic" | "static"
			Family:    family(ip),
		})
	}
	return entries, nil
}

func normalizeMAC(s string) string {
	s = strings.ReplaceAll(s, "-", ":")
	if len(s) != 17 {
		return ""
	}
	return strings.ToLower(s)
}

func family(ip string) string {
	if strings.Contains(ip, ":") {
		return "v6"
	}
	return "v4"
}
