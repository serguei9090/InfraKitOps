package ansible

import "errors"

var (
	ErrNotFound    = errors.New("not found")
	ErrRuntime     = errors.New("ansible runtime not ready")
	ErrOutsideRoot = errors.New("path escapes the project")
	ErrNoWorkspace = errors.New("the ansible workspace folder is not set")
)

// Project is one ansible project directory (AN0: local only; git in AN5).
type Project struct {
	ID        string `json:"id"`
	Owner     string `json:"owner,omitempty"`
	Name      string `json:"name"`
	Path      string `json:"path"`   // absolute
	Source    string `json:"source"` // "local" | "git" (AN5)
	Published bool   `json:"published"`
	CreatedAt int64  `json:"createdAt"`
}

// ProjectTree is the live scan of a project's contents (not persisted).
type ProjectTree struct {
	Playbooks   []string `json:"playbooks"`   // relative paths of files whose top level is a list of plays
	Roles       []string `json:"roles"`       // dir names under roles/
	Collections []string `json:"collections"` // "ns.name" under collections/ansible_collections/
	Inventories []string `json:"inventories"` // relative paths / dirs usable as -i
	HasConfig   bool     `json:"hasConfig"`   // ansible.cfg present
	HasReqs     bool     `json:"hasReqs"`     // requirements.yml present
}

// RunSpec is one playbook run request. AN0 is credential-free (ambient SSH /
// ansible.cfg); AN1 adds vault + SSH secret refs.
type RunSpec struct {
	ProjectID string `json:"projectId"`
	Playbook  string `json:"playbook"` // relative to the project
	Inventory string `json:"inventory,omitempty"`
	Limit     string `json:"limit,omitempty"`
	Tags      string `json:"tags,omitempty"`
	SkipTags  string `json:"skipTags,omitempty"`
	ExtraVars string `json:"extraVars,omitempty"` // YAML/JSON blob → -e @file
	Check     bool   `json:"check,omitempty"`
	Diff      bool   `json:"diff,omitempty"`
	Become    bool   `json:"become,omitempty"`
	Verbosity int    `json:"verbosity,omitempty"` // 0..4 → -v..-vvvv
	Forks     int    `json:"forks,omitempty"`
}

// Run is one recorded execution.
type Run struct {
	ID          int64  `json:"id"`
	Owner       string `json:"owner,omitempty"`
	ProjectID   string `json:"projectId"`
	Playbook    string `json:"playbook"`
	Status      string `json:"status"`           // running | ok | failed | unreachable | cancelled
	Argv        string `json:"argv"`             // redacted
	Events      string `json:"events,omitempty"` // newline-delimited JSON, for replay
	Recap       string `json:"recap,omitempty"`  // JSON: host → counts
	TriggeredBy string `json:"triggeredBy"`
	StartedAt   int64  `json:"startedAt"`
	FinishedAt  int64  `json:"finishedAt"`
}

const (
	StatusRunning     = "running"
	StatusOK          = "ok"
	StatusFailed      = "failed"
	StatusUnreachable = "unreachable"
	StatusCancelled   = "cancelled"
)
