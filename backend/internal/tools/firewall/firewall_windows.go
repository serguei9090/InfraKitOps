//go:build windows

package firewall

import (
	"os/exec"
	"strings"
	"syscall"
)

// listImpl parses `netsh advfirewall firewall show rule name=all verbose`.
// Read works without elevation for most rule stores.
func listImpl() (Result, error) {
	cmd := exec.Command("netsh", "advfirewall", "firewall", "show", "rule", "name=all", "verbose")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return Result{}, err
	}

	res := Result{V: 1, Backend: "windows-firewall"}
	var cur *Rule
	flush := func() {
		if cur != nil && cur.Name != "" {
			res.Rules = append(res.Rules, *cur)
		}
		cur = nil
	}

	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.HasPrefix(line, "----------") {
			continue
		}
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)

		switch key {
		case "Rule Name":
			flush()
			cur = &Rule{Name: val, Enabled: true, Direction: "inbound", Action: "allow"}
		case "Enabled":
			if cur != nil {
				cur.Enabled = strings.EqualFold(val, "Yes")
			}
		case "Direction":
			if cur != nil {
				if strings.EqualFold(val, "Out") {
					cur.Direction = "outbound"
				} else {
					cur.Direction = "inbound"
				}
			}
		case "Profiles":
			set(cur, func(r *Rule) { r.Profiles = val })
		case "Grouping":
			set(cur, func(r *Rule) { r.Grouping = val })
		case "LocalIP":
			set(cur, func(r *Rule) { r.LocalAddresses = val })
		case "RemoteIP":
			set(cur, func(r *Rule) { r.RemoteAddresses = val })
		case "Protocol":
			set(cur, func(r *Rule) { r.Protocol = val })
		case "LocalPort":
			set(cur, func(r *Rule) { r.LocalPorts = val })
		case "RemotePort":
			set(cur, func(r *Rule) { r.RemotePorts = val })
		case "Program":
			set(cur, func(r *Rule) { r.Program = val })
		case "Description":
			set(cur, func(r *Rule) { r.Description = val })
		case "Action":
			if cur != nil {
				if strings.EqualFold(val, "Block") {
					cur.Action = "block"
				} else {
					cur.Action = "allow"
				}
			}
		}
	}
	flush()
	return res, nil
}

func set(r *Rule, f func(*Rule)) {
	if r != nil {
		f(r)
	}
}
