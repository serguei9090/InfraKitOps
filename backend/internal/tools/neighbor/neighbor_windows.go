//go:build windows

package neighbor

import (
	"context"
	"regexp"
	"strings"

	"github.com/infrakit/backend/internal/cmdtool"
)

// listImpl prefers Get-NetNeighbor (structured, IPv4+IPv6, real states) and
// falls back to parsing `arp -a` if PowerShell is unavailable.
func listImpl(ctx context.Context) ([]Entry, string, error) {
	var rows []struct {
		IPAddress        string `json:"IPAddress"`
		LinkLayerAddress string `json:"LinkLayerAddress"`
		InterfaceAlias   string `json:"InterfaceAlias"`
		State            string `json:"State"`
		AddressFamily    string `json:"AddressFamily"`
	}
	err := cmdtool.PowerShellArray(ctx, &rows,
		`Get-NetNeighbor -ErrorAction SilentlyContinue | `+
			`Select-Object @{n='IPAddress';e={$_.IPAddress}},`+
			`@{n='LinkLayerAddress';e={$_.LinkLayerAddress}},`+
			`@{n='InterfaceAlias';e={$_.InterfaceAlias}},`+
			`@{n='State';e={[string]$_.State}},`+
			`@{n='AddressFamily';e={[string]$_.AddressFamily}} | `+
			`ConvertTo-Json -Depth 3 -Compress`)
	if err == nil && len(rows) > 0 {
		out := make([]Entry, 0, len(rows))
		for _, r := range rows {
			if r.LinkLayerAddress == "" {
				continue
			}
			out = append(out, Entry{
				IP:        r.IPAddress,
				MAC:       normalizeMAC(r.LinkLayerAddress),
				Interface: r.InterfaceAlias,
				State:     normalizeState(r.State),
				Family:    familyFromPS(r.AddressFamily, r.IPAddress),
			})
		}
		return out, "Get-NetNeighbor", nil
	}
	return arpFallback(ctx)
}

func familyFromPS(s, ip string) string {
	switch strings.ToLower(s) {
	case "ipv6":
		return "v6"
	case "ipv4":
		return "v4"
	}
	return family(ip)
}

var (
	arpIface = regexp.MustCompile(`^Interface:\s+(\S+)`)
	arpRow   = regexp.MustCompile(`^\s*([0-9a-fA-F:.]+)\s+([0-9a-fA-F-]{11,17})\s+(\w+)`)
)

func arpFallback(ctx context.Context) ([]Entry, string, error) {
	out, err := cmdtool.Run(ctx, "arp", "-a")
	if err != nil {
		return nil, "", err
	}
	var entries []Entry
	iface := ""
	for _, line := range strings.Split(string(out), "\n") {
		if m := arpIface.FindStringSubmatch(line); m != nil {
			iface = m[1]
			continue
		}
		if m := arpRow.FindStringSubmatch(line); m != nil {
			entries = append(entries, Entry{
				IP: m[1], MAC: normalizeMAC(m[2]), Interface: iface,
				State: strings.ToLower(m[3]), Family: family(m[1]),
			})
		}
	}
	return entries, "arp", nil
}
