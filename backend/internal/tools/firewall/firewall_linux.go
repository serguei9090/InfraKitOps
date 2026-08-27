//go:build linux

package firewall

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"github.com/infrakit/backend/internal/cmdtool"
)

// listImpl detects the active manager. firewalld gives rich rules; nftables
// gives native JSON (`nft -j`); ufw a flat view.
func listImpl() (Result, error) {
	ctx := context.Background()
	if _, err := exec.LookPath("firewall-cmd"); err == nil {
		if out, err := cmdtool.Run(ctx, "firewall-cmd", "--list-all"); err == nil {
			return parseFirewalld(string(out)), nil
		}
	}
	if _, err := exec.LookPath("nft"); err == nil {
		if r, err := parseNft(ctx); err == nil {
			return r, nil
		}
	}
	if _, err := exec.LookPath("ufw"); err == nil {
		if out, err := cmdtool.Run(ctx, "ufw", "status", "verbose"); err == nil {
			return parseUfw(string(out)), nil
		}
	}
	return Result{V: 1, Backend: "unknown", Note: "no supported firewall manager found (firewalld / nftables / ufw)"}, nil
}

// parseNft reads `nft -j list ruleset` — libnftables' native JSON — and maps
// each rule to the normalized Rule shape.
func parseNft(ctx context.Context) (Result, error) {
	raw, err := cmdtool.Run(ctx, "nft", "-j", "list", "ruleset")
	if err != nil {
		return Result{}, err
	}
	var doc struct {
		Nftables []map[string]json.RawMessage `json:"nftables"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return Result{}, err
	}

	res := Result{V: 1, Backend: "nftables"}
	chainDir := map[string]string{} // "table/chain" -> hook direction

	for _, obj := range doc.Nftables {
		if c, ok := obj["chain"]; ok {
			var ch struct {
				Family string `json:"family"`
				Table  string `json:"table"`
				Name   string `json:"name"`
				Hook   string `json:"hook"`
			}
			_ = json.Unmarshal(c, &ch)
			chainDir[ch.Table+"/"+ch.Name] = hookToDir(ch.Hook)
		}
		if r, ok := obj["rule"]; ok {
			var rule struct {
				Family  string            `json:"family"`
				Table   string            `json:"table"`
				Chain   string            `json:"chain"`
				Expr    []json.RawMessage `json:"expr"`
				Comment string            `json:"comment"`
			}
			_ = json.Unmarshal(r, &rule)
			res.Rules = append(res.Rules, Rule{
				Name:        firstNonEmpty(rule.Comment, fmt.Sprintf("%s/%s", rule.Table, rule.Chain)),
				Enabled:     true,
				Direction:   firstNonEmpty(chainDir[rule.Table+"/"+rule.Chain], "inbound"),
				Action:      nftVerdict(rule.Expr),
				Grouping:    fmt.Sprintf("%s %s / %s", rule.Family, rule.Table, rule.Chain),
				Description: rule.Comment,
			})
		}
	}
	if len(res.Rules) == 0 {
		res.Note = "nftables ruleset is empty"
	}
	return res, nil
}

func hookToDir(hook string) string {
	switch hook {
	case "output", "postrouting":
		return "outbound"
	case "input", "prerouting", "forward":
		return "inbound"
	}
	return ""
}

func nftVerdict(exprs []json.RawMessage) string {
	for _, e := range exprs {
		s := string(e)
		if strings.Contains(s, `"drop"`) || strings.Contains(s, `"reject"`) {
			return "block"
		}
		if strings.Contains(s, `"accept"`) {
			return "allow"
		}
	}
	return "allow"
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
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
