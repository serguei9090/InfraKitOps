//go:build linux

package neighbor

import (
	"bufio"
	"os"
	"strings"
)

// listImpl reads /proc/net/arp (IPv4). IPv6/NDP via `ip -6 neigh` or netlink is
// a later addition.
func listImpl() ([]Entry, error) {
	f, err := os.Open("/proc/net/arp")
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var entries []Entry
	sc := bufio.NewScanner(f)
	sc.Scan() // header
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 6 {
			continue
		}
		ip, flags, mac, dev := fields[0], fields[2], strings.ToLower(fields[3]), fields[5]
		if mac == "00:00:00:00:00:00" {
			continue
		}
		state := "stale"
		if flags == "0x2" {
			state = "reachable"
		} else if flags == "0x6" {
			state = "permanent"
		}
		entries = append(entries, Entry{IP: ip, MAC: mac, Interface: dev, State: state, Family: "v4"})
	}
	return entries, sc.Err()
}
