// Package neighbor reads the OS ARP / NDP cache (IP ⟷ MAC ⟷ interface).
// Read-only, no privileges. Uses the structured-output mode of the OS built-in
// (`Get-NetNeighbor | ConvertTo-Json` on Windows, `ip -j neigh` on Linux) so
// the parser is a typed unmarshal — see CLAUDE.md. Static add / delete
// (elevated) is a later addition.
package neighbor

import (
	"context"
	"sort"
	"strings"
)

// Entry is one neighbor-cache row.
type Entry struct {
	IP        string `json:"ip"`
	MAC       string `json:"mac"`
	Interface string `json:"interface,omitempty"`
	State     string `json:"state,omitempty"` // reachable | stale | permanent | probe | delay | incomplete
	Family    string `json:"family"`          // v4 | v6
}

type tableRow struct {
	Key   string            `json:"key"`
	Cells map[string]string `json:"cells"`
}

// Result — shape "table".
type Result struct {
	V       int        `json:"v"`
	Entries []Entry    `json:"entries"`
	Rows    []tableRow `json:"rows"`
	Source  string     `json:"source"` // "Get-NetNeighbor" | "ip neigh" | "arp"
}

// List returns the current neighbor cache, sorted by IP.
func List(ctx context.Context) (Result, error) {
	entries, source, err := listImpl(ctx)
	if err != nil {
		return Result{}, err
	}
	entries = filtered(entries)
	sort.Slice(entries, func(i, j int) bool { return ipLess(entries[i].IP, entries[j].IP) })

	rows := make([]tableRow, 0, len(entries))
	for _, e := range entries {
		rows = append(rows, tableRow{
			Key:   e.IP,
			Cells: map[string]string{"mac": e.MAC, "interface": e.Interface, "state": e.State},
		})
	}
	return Result{V: 1, Entries: entries, Rows: rows, Source: source}, nil
}

// filtered drops broadcast / all-zero / multicast MAC rows.
func filtered(in []Entry) []Entry {
	out := in[:0]
	for _, e := range in {
		m := strings.ToLower(e.MAC)
		if m == "" || m == "00:00:00:00:00:00" || m == "ff:ff:ff:ff:ff:ff" ||
			strings.HasPrefix(m, "01:00:5e") || strings.HasPrefix(m, "33:33") {
			continue
		}
		out = append(out, e)
	}
	return out
}

func normalizeState(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	switch s {
	case "reachable", "stale", "permanent", "probe", "delay", "incomplete", "none", "noarp", "failed":
		return s
	default:
		return s
	}
}

func normalizeMAC(s string) string {
	s = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(s), "-", ":"))
	if len(s) == 12 && !strings.Contains(s, ":") {
		var b strings.Builder
		for i := 0; i < 12; i += 2 {
			if i > 0 {
				b.WriteByte(':')
			}
			b.WriteString(s[i : i+2])
		}
		return b.String()
	}
	return s
}

func family(ip string) string {
	if strings.Contains(ip, ":") {
		return "v6"
	}
	return "v4"
}

func ipLess(a, b string) bool {
	pa, pb := splitOctets(a), splitOctets(b)
	if pa == nil || pb == nil {
		return a < b
	}
	for i := range pa {
		if pa[i] != pb[i] {
			return pa[i] < pb[i]
		}
	}
	return false
}

func splitOctets(ip string) []int {
	parts := make([]int, 0, 4)
	cur, seen := 0, false
	for _, r := range ip {
		switch {
		case r >= '0' && r <= '9':
			cur = cur*10 + int(r-'0')
			seen = true
		case r == '.':
			parts = append(parts, cur)
			cur, seen = 0, false
		default:
			return nil
		}
	}
	if seen {
		parts = append(parts, cur)
	}
	if len(parts) != 4 {
		return nil
	}
	return parts
}
