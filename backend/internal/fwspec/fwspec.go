// Package fwspec holds the pure, dependency-free firewall-change model shared
// by the backend's firewall package and the elevated infrakit-helper. Keeping
// it a leaf package means the helper (which runs as Administrator) re-derives
// the exact `netsh` argument vector from the same code the backend validated,
// so a caller can never inject arguments. See NETWORK_MODULE_PLAN.md §1.2.
package fwspec

import (
	"fmt"
	"regexp"
	"strings"
)

// ChangeOp is the kind of edit.
type ChangeOp string

const (
	OpAdd        ChangeOp = "add"
	OpDelete     ChangeOp = "delete"
	OpSetEnabled ChangeOp = "set-enabled"
)

// RuleSpec is the user-editable, strictly-validated subset of a firewall rule.
type RuleSpec struct {
	Name       string `json:"name"`
	Direction  string `json:"direction"` // inbound | outbound
	Action     string `json:"action"`    // allow | block
	Protocol   string `json:"protocol"`  // tcp | udp | any
	LocalPort  string `json:"localPort"` // "" | "443" | "80,443" | "1000-2000"
	RemoteAddr string `json:"remoteAddr"`
	Enabled    bool   `json:"enabled"` // for set-enabled
}

// Change is one edit request.
type Change struct {
	Op   ChangeOp `json:"op"`
	Rule RuleSpec `json:"rule"`
}

var (
	nameRe = regexp.MustCompile(`^[A-Za-z0-9 ._:()\-/]{1,128}$`)
	portRe = regexp.MustCompile(`^(\d{1,5})(-\d{1,5})?(,\d{1,5}(-\d{1,5})?)*$`)
	addrRe = regexp.MustCompile(`^[0-9a-fA-F:./]{1,64}$`)
)

// Validate rejects anything that isn't a plain, well-formed rule. This is a
// security boundary: the values become process arguments run as Administrator.
func (r RuleSpec) Validate(op ChangeOp) error {
	if !nameRe.MatchString(r.Name) {
		return fmt.Errorf("rule name must be 1-128 chars of letters, digits, spaces or ._:()-/")
	}
	if op == OpDelete || op == OpSetEnabled {
		return nil
	}
	switch r.Direction {
	case "inbound", "outbound":
	default:
		return fmt.Errorf("direction must be inbound or outbound")
	}
	switch r.Action {
	case "allow", "block":
	default:
		return fmt.Errorf("action must be allow or block")
	}
	switch strings.ToLower(r.Protocol) {
	case "tcp", "udp", "any", "":
	default:
		return fmt.Errorf("protocol must be tcp, udp or any")
	}
	if r.LocalPort != "" && !portRe.MatchString(r.LocalPort) {
		return fmt.Errorf("local port must be a number, list or range, e.g. 443 or 80,443 or 1000-2000")
	}
	if r.RemoteAddr != "" && !addrRe.MatchString(r.RemoteAddr) {
		return fmt.Errorf("remote address must be an IP or CIDR")
	}
	return nil
}

// NetshArgs derives the exact `netsh` argument vector for a change.
func NetshArgs(c Change) ([]string, error) {
	if err := c.Rule.Validate(c.Op); err != nil {
		return nil, err
	}
	r := c.Rule
	switch c.Op {
	case OpDelete:
		return []string{"advfirewall", "firewall", "delete", "rule", "name=" + r.Name}, nil
	case OpSetEnabled:
		state := "yes"
		if !r.Enabled {
			state = "no"
		}
		return []string{"advfirewall", "firewall", "set", "rule", "name=" + r.Name, "new", "enable=" + state}, nil
	case OpAdd:
		dir := "in"
		if r.Direction == "outbound" {
			dir = "out"
		}
		args := []string{
			"advfirewall", "firewall", "add", "rule",
			"name=" + r.Name,
			"dir=" + dir,
			"action=" + r.Action,
		}
		switch strings.ToLower(r.Protocol) {
		case "tcp", "udp":
			args = append(args, "protocol="+strings.ToUpper(r.Protocol))
			if r.LocalPort != "" {
				args = append(args, "localport="+r.LocalPort)
			}
		default:
			args = append(args, "protocol=any")
		}
		if r.RemoteAddr != "" {
			args = append(args, "remoteip="+r.RemoteAddr)
		}
		return args, nil
	default:
		return nil, fmt.Errorf("unknown op %q", c.Op)
	}
}

// managementPorts are the ports whose accidental blocking would lock a remote
// admin out of the box.
var managementPorts = map[string]string{
	"22": "SSH", "3389": "RDP", "5985": "WinRM (HTTP)", "5986": "WinRM (HTTPS)",
}

// AssessLockout returns human-readable warnings when a change could cut off
// remote management. An empty slice means "looks safe". The API requires an
// explicit confirm flag whenever this is non-empty.
func AssessLockout(c Change) []string {
	var warnings []string
	r := c.Rule

	touchesMgmt := func() string {
		for _, p := range strings.Split(r.LocalPort, ",") {
			if label, ok := managementPorts[strings.TrimSpace(p)]; ok {
				return label
			}
		}
		return ""
	}

	switch c.Op {
	case OpAdd:
		if r.Direction == "inbound" && r.Action == "block" {
			if r.LocalPort == "" {
				warnings = append(warnings, "This blocks ALL inbound traffic — you may lose remote access to this machine.")
			} else if label := touchesMgmt(); label != "" {
				warnings = append(warnings, fmt.Sprintf("This blocks inbound %s (port %s) — a remote session on it would be cut.", label, r.LocalPort))
			}
		}
	case OpDelete:
		warnings = append(warnings, "Deleting a rule can expose or block a service depending on what it did — review it first.")
	case OpSetEnabled:
		if !r.Enabled {
			warnings = append(warnings, "Disabling a rule changes what traffic is allowed or blocked.")
		}
	}
	return warnings
}
