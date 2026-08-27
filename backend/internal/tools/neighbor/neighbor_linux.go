//go:build linux

package neighbor

import (
	"context"
	"os"
	"strings"

	"github.com/infrakit/backend/internal/cmdtool"
)

// listImpl uses `ip -j neigh` (JSON, IPv4 + IPv6/NDP) and falls back to
// parsing /proc/net/arp if the iproute2 binary is missing.
func listImpl(ctx context.Context) ([]Entry, string, error) {
	var rows []struct {
		Dst    string   `json:"dst"`
		Dev    string   `json:"dev"`
		LLAddr string   `json:"lladdr"`
		State  []string `json:"state"`
	}
	if err := cmdtool.RunJSON(ctx, &rows, "ip", "-j", "neigh"); err == nil {
		out := make([]Entry, 0, len(rows))
		for _, r := range rows {
			if r.LLAddr == "" {
				continue
			}
			state := ""
			if len(r.State) > 0 {
				state = normalizeState(r.State[0])
			}
			out = append(out, Entry{
				IP: r.Dst, MAC: normalizeMAC(r.LLAddr), Interface: r.Dev,
				State: state, Family: family(r.Dst),
			})
		}
		return out, "ip neigh", nil
	}
	return procNetArp()
}

func procNetArp() ([]Entry, string, error) {
	raw, err := os.ReadFile("/proc/net/arp")
	if err != nil {
		return nil, "", err
	}
	var entries []Entry
	lines := strings.Split(string(raw), "\n")
	for i, line := range lines {
		if i == 0 {
			continue
		}
		f := strings.Fields(line)
		if len(f) < 6 || f[3] == "00:00:00:00:00:00" {
			continue
		}
		state := "stale"
		switch f[2] {
		case "0x2":
			state = "reachable"
		case "0x6":
			state = "permanent"
		}
		entries = append(entries, Entry{
			IP: f[0], MAC: normalizeMAC(f[3]), Interface: f[5], State: state, Family: "v4",
		})
	}
	return entries, "/proc/net/arp", nil
}
