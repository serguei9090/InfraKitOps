//go:build linux

package firewall

import (
	"os/exec"
	"strings"
)

// listImpl detects the active manager and returns a best-effort read.
// firewalld gives rich rules; ufw/nft give a flatter view.
func listImpl() (Result, error) {
	if _, err := exec.LookPath("firewall-cmd"); err == nil {
		if out, err := exec.Command("firewall-cmd", "--list-all").Output(); err == nil {
			return parseFirewalld(string(out)), nil
		}
	}
	if _, err := exec.LookPath("ufw"); err == nil {
		if out, err := exec.Command("ufw", "status", "verbose").Output(); err == nil {
			return parseUfw(string(out)), nil
		}
	}
	if _, err := exec.LookPath("nft"); err == nil {
		if out, err := exec.Command("nft", "list", "ruleset").Output(); err == nil {
			return Result{V: 1, Backend: "nftables", Note: "raw nftables ruleset — not normalized", Rules: []Rule{{Name: "ruleset", Description: string(out), Enabled: true, Direction: "inbound", Action: "allow"}}}, nil
		}
	}
	return Result{V: 1, Backend: "unknown", Note: "no supported firewall manager found (firewalld / ufw / nftables)"}, nil
}

func parseFirewalld(out string) Result {
	res := Result{V: 1, Backend: "firewalld"}
	zone := "default"
	for _, line := range strings.Split(out, "\n") {
		t := strings.TrimSpace(line)
		switch {
		case strings.HasSuffix(t, "(active)") || (t != "" && !strings.Contains(t, ":") && !strings.HasPrefix(line, " ")):
			zone = strings.Fields(t)[0]
		case strings.HasPrefix(t, "services:"):
			for _, s := range strings.Fields(strings.TrimPrefix(t, "services:")) {
				res.Rules = append(res.Rules, Rule{Name: "service " + s, Enabled: true, Direction: "inbound", Action: "allow", Profiles: zone, Grouping: "services"})
			}
		case strings.HasPrefix(t, "ports:"):
			for _, p := range strings.Fields(strings.TrimPrefix(t, "ports:")) {
				res.Rules = append(res.Rules, Rule{Name: "port " + p, Enabled: true, Direction: "inbound", Action: "allow", Profiles: zone, LocalPorts: p, Grouping: "ports"})
			}
		case strings.HasPrefix(t, "rich rules:"):
		case strings.HasPrefix(t, "rule "):
			res.Rules = append(res.Rules, parseRichRule(t, zone))
		}
	}
	return res
}

func parseRichRule(t, zone string) Rule {
	r := Rule{Name: t, Enabled: true, Direction: "inbound", Action: "allow", Profiles: zone, Grouping: "rich rule"}
	if strings.Contains(t, "reject") || strings.Contains(t, "drop") {
		r.Action = "block"
	}
	if i := strings.Index(t, `port port="`); i >= 0 {
		rest := t[i+len(`port port="`):]
		if j := strings.IndexByte(rest, '"'); j >= 0 {
			r.LocalPorts = rest[:j]
		}
	}
	if i := strings.Index(t, `source address="`); i >= 0 {
		rest := t[i+len(`source address="`):]
		if j := strings.IndexByte(rest, '"'); j >= 0 {
			r.RemoteAddresses = rest[:j]
		}
	}
	return r
}

func parseUfw(out string) Result {
	res := Result{V: 1, Backend: "ufw"}
	inRules := false
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(line, "--") {
			inRules = true
			continue
		}
		if !inRules || strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		// "To  Action  From" columns; Action like "ALLOW IN" / "DENY OUT"
		rule := Rule{Name: line, Enabled: true, Direction: "inbound", Action: "allow"}
		joined := strings.ToUpper(line)
		if strings.Contains(joined, "DENY") || strings.Contains(joined, "REJECT") {
			rule.Action = "block"
		}
		if strings.Contains(joined, " OUT") {
			rule.Direction = "outbound"
		}
		rule.LocalPorts = fields[0]
		rule.RemoteAddresses = fields[len(fields)-1]
		res.Rules = append(res.Rules, rule)
	}
	return res
}
