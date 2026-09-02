package ansible

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	yaml "go.yaml.in/yaml/v3"
)

// starter files written by Scaffold — a minimal but conventional layout.
var scaffold = map[string]string{
	"ansible.cfg": `[defaults]
inventory = ./inventory/hosts.ini
roles_path = ./roles
collections_paths = ./collections
host_key_checking = True
stdout_callback = default
`,
	"inventory/hosts.ini": `[local]
localhost ansible_connection=local
`,
	"group_vars/all.yml": "---\n# variables applied to every host\n",
	"requirements.yml":   "---\nroles: []\ncollections: []\n",
	"site.yml": `---
- name: Example play
  hosts: local
  gather_facts: false
  tasks:
    - name: Ping
      ansible.builtin.ping:
`,
	"roles/.keep":       "",
	"collections/.keep": "",
	"host_vars/.keep":   "",
}

// Scaffold creates a fresh project directory. Fails if `dir` exists and is
// non-empty.
func Scaffold(dir string) error {
	if entries, err := os.ReadDir(dir); err == nil && len(entries) > 0 {
		return fmt.Errorf("%s already exists and is not empty", dir)
	}
	for rel, body := range scaffold {
		p := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			return err
		}
	}
	return nil
}

// ScanTree walks a project directory and reports its ansible content. Bounded
// depth so a huge tree (a `roles/` full of git checkouts) can't stall.
func ScanTree(dir string) (ProjectTree, error) {
	t := ProjectTree{Playbooks: []string{}, Roles: []string{}, Collections: []string{}, Inventories: []string{}}
	if fi, err := os.Stat(dir); err != nil || !fi.IsDir() {
		return t, fmt.Errorf("not a directory: %s", dir)
	}

	if _, err := os.Stat(filepath.Join(dir, "ansible.cfg")); err == nil {
		t.HasConfig = true
	}
	for _, r := range []string{"requirements.yml", "requirements.yaml"} {
		if _, err := os.Stat(filepath.Join(dir, r)); err == nil {
			t.HasReqs = true
		}
	}

	// roles/
	if es, err := os.ReadDir(filepath.Join(dir, "roles")); err == nil {
		for _, e := range es {
			if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
				t.Roles = append(t.Roles, e.Name())
			}
		}
	}
	// collections/ansible_collections/<ns>/<name>
	collRoot := filepath.Join(dir, "collections", "ansible_collections")
	if nss, err := os.ReadDir(collRoot); err == nil {
		for _, ns := range nss {
			if !ns.IsDir() {
				continue
			}
			if names, err := os.ReadDir(filepath.Join(collRoot, ns.Name())); err == nil {
				for _, n := range names {
					if n.IsDir() {
						t.Collections = append(t.Collections, ns.Name()+"."+n.Name())
					}
				}
			}
		}
	}
	// inventory/ dir or file
	for _, inv := range []string{"inventory", "inventory.ini", "inventory.yml", "inventory.yaml", "hosts", "hosts.ini"} {
		if _, err := os.Stat(filepath.Join(dir, inv)); err == nil {
			t.Inventories = append(t.Inventories, inv)
		}
	}

	// playbooks: *.yml / *.yaml at the root and under playbooks/ whose top
	// level is a YAML list (a list of plays).
	roots := []string{dir, filepath.Join(dir, "playbooks")}
	for _, root := range roots {
		es, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, e := range es {
			if e.IsDir() || !isYAML(e.Name()) {
				continue
			}
			full := filepath.Join(root, e.Name())
			if looksLikePlaybook(full) {
				rel, _ := filepath.Rel(dir, full)
				t.Playbooks = append(t.Playbooks, filepath.ToSlash(rel))
			}
		}
	}
	return t, nil
}

func isYAML(name string) bool {
	l := strings.ToLower(name)
	return strings.HasSuffix(l, ".yml") || strings.HasSuffix(l, ".yaml")
}

// looksLikePlaybook is true when the file parses as a non-empty YAML sequence
// whose first mapping has a play-ish key (hosts / import_playbook / roles).
func looksLikePlaybook(path string) bool {
	b, err := os.ReadFile(path)
	if err != nil || len(b) > 1<<20 {
		return false
	}
	var docs []map[string]any
	if yaml.Unmarshal(b, &docs) != nil || len(docs) == 0 {
		return false
	}
	for _, d := range docs {
		for _, k := range []string{"hosts", "import_playbook", "ansible.builtin.import_playbook", "roles", "tasks"} {
			if _, ok := d[k]; ok {
				return true
			}
		}
	}
	return false
}
