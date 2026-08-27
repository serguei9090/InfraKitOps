//go:build !windows && !linux

package neighbor

import (
	"context"
	"regexp"
	"strings"

	"github.com/infrakit/backend/internal/cmdtool"
)

var bsdRow = regexp.MustCompile(`\(([0-9a-fA-F.:]+)\)\s+at\s+([0-9a-fA-F:]{11,17})(?:\s+on\s+(\S+))?`)

// listImpl parses `arp -a` (BSD / macOS format).
func listImpl(ctx context.Context) ([]Entry, string, error) {
	out, err := cmdtool.Run(ctx, "arp", "-a")
	if err != nil {
		return nil, "", err
	}
	var entries []Entry
	for _, line := range strings.Split(string(out), "\n") {
		m := bsdRow.FindStringSubmatch(line)
		if m == nil || strings.Contains(line, "incomplete") {
			continue
		}
		entries = append(entries, Entry{
			IP: m[1], MAC: normalizeMAC(m[2]), Interface: m[3], Family: family(m[1]),
		})
	}
	return entries, "arp", nil
}
