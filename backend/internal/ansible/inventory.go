package ansible

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// InventoryResult is the parsed view of a project's inventory.
type InventoryResult struct {
	// Graph is `ansible-inventory --graph` text (indented group/host tree).
	Graph string `json:"graph"`
	// Groups maps a group name to its direct host names.
	Groups map[string][]string `json:"groups"`
	// Hosts is every host with its resolved vars.
	Hosts map[string]map[string]any `json:"hosts"`
	// Source is the -i value used ("" = project default from ansible.cfg).
	Source string `json:"source"`
}

// ansibleInventoryList is the shape of `ansible-inventory --list` output.
type ansibleInventoryList struct {
	Meta struct {
		HostVars map[string]map[string]any `json:"hostvars"`
	} `json:"_meta"`
	// every other key is a group: {hosts?: [...], children?: [...], vars?: {...}}
}

// Inventory resolves a project's inventory via `ansible-inventory`. `src` is an
// optional -i value (a path relative to the project, or a host list); "" uses
// the project's ansible.cfg default.
func (e *Engine) Inventory(ctx context.Context, owner string, mode RuntimeMode, projectID, src string) (*InventoryResult, error) {
	proj, err := e.store.GetProject(owner, projectID)
	if err != nil {
		return nil, err
	}
	inv := ""
	if s := strings.TrimSpace(src); s != "" {
		if strings.Contains(s, ",") {
			inv = s // explicit host list
		} else {
			p, jerr := safeJoin(proj.Path, s)
			if jerr != nil {
				return nil, jerr
			}
			inv = p
		}
	}

	run := func(extra ...string) ([]byte, error) {
		args := extra
		if inv != "" {
			args = append([]string{"-i", inv}, args...)
		}
		c, cancel := context.WithTimeout(ctx, 40*time.Second)
		defer cancel()
		cmd, cerr := e.activeRunner(c).Command(c, "ansible-inventory", proj.Path, args, nil)
		if cerr != nil {
			return nil, cerr
		}
		return cmd.Output()
	}

	listOut, err := run("--list")
	if err != nil {
		return nil, fmt.Errorf("ansible-inventory --list: %w", trimExecErr(err))
	}
	graphOut, _ := run("--graph")

	res := &InventoryResult{
		Graph:  string(graphOut),
		Groups: map[string][]string{},
		Hosts:  map[string]map[string]any{},
		Source: src,
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(listOut, &raw); err != nil {
		return nil, fmt.Errorf("parse inventory: %w", err)
	}
	for name, blob := range raw {
		if name == "_meta" {
			continue
		}
		var g struct {
			Hosts []string `json:"hosts"`
		}
		if json.Unmarshal(blob, &g) == nil && len(g.Hosts) > 0 {
			res.Groups[name] = g.Hosts
		} else if res.Groups[name] == nil {
			res.Groups[name] = []string{}
		}
	}
	var meta ansibleInventoryList
	if json.Unmarshal(listOut, &meta) == nil {
		for host, vars := range meta.Meta.HostVars {
			res.Hosts[host] = vars
		}
	}
	// hosts that appear in a group but have no _meta entry
	for _, hosts := range res.Groups {
		for _, h := range hosts {
			if _, ok := res.Hosts[h]; !ok {
				res.Hosts[h] = map[string]any{}
			}
		}
	}
	return res, nil
}
