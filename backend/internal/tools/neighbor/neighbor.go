// Package neighbor reads the OS ARP / NDP cache (IP ⟷ MAC ⟷ interface).
// Read-only, no privileges. Static-add / delete (elevated) is a later
// addition. See NETWORK_MODULE_PLAN.md tool #12.
package neighbor

import "sort"

// Entry is one neighbor-cache row.
type Entry struct {
	IP        string `json:"ip"`
	MAC       string `json:"mac"`
	Interface string `json:"interface,omitempty"`
	State     string `json:"state,omitempty"` // reachable | stale | permanent | dynamic | …
	Family    string `json:"family"`          // v4 | v6
}

// tableRow is the {key, cells} shape the history table-diff consumes.
type tableRow struct {
	Key   string            `json:"key"`
	Cells map[string]string `json:"cells"`
}

// Result — shape "table".
type Result struct {
	V       int        `json:"v"`
	Entries []Entry    `json:"entries"`
	Rows    []tableRow `json:"rows"`
}

// List returns the current neighbor cache, sorted by IP.
func List() (Result, error) {
	entries, err := listImpl()
	if err != nil {
		return Result{}, err
	}
	sort.Slice(entries, func(i, j int) bool { return ipLess(entries[i].IP, entries[j].IP) })
	rows := make([]tableRow, 0, len(entries))
	for _, e := range entries {
		rows = append(rows, tableRow{
			Key:   e.IP,
			Cells: map[string]string{"mac": e.MAC, "interface": e.Interface, "state": e.State},
		})
	}
	return Result{V: 1, Entries: entries, Rows: rows}, nil
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
		if r >= '0' && r <= '9' {
			cur = cur*10 + int(r-'0')
			seen = true
		} else if r == '.' {
			parts = append(parts, cur)
			cur, seen = 0, false
		} else {
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
