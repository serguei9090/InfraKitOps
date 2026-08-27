//go:build !windows && !linux

package neighbor

import (
	"os/exec"
	"regexp"
	"strings"
)

var bsdRow = regexp.MustCompile(`\(([0-9a-fA-F.:]+)\)\s+at\s+([0-9a-fA-F:]{11,17})(?:\s+on\s+(\S+))?`)

// listImpl parses `arp -a` (BSD / macOS format).
func listImpl() ([]Entry, error) {
	out, err := exec.Command("arp", "-a").Output()
	if err != nil {
		return nil, err
	}
	var entries []Entry
	for _, line := range strings.Split(string(out), "\n") {
		m := bsdRow.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		mac := strings.ToLower(m[2])
		if mac == "" || strings.Contains(line, "incomplete") {
			continue
		}
		fam := "v4"
		if strings.Contains(m[1], ":") {
			fam = "v6"
		}
		entries = append(entries, Entry{IP: m[1], MAC: mac, Interface: m[3], Family: fam})
	}
	return entries, nil
}
