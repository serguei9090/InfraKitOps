package ansible

import "errors"

var (
	ErrNotFound    = errors.New("not found")
	ErrRuntime     = errors.New("ansible runtime not ready")
	ErrOutsideRoot = errors.New("path escapes the project")
	ErrNoWorkspace = errors.New("the ansible workspace folder is not set")
)

// Project is one ansible project directory.
type Project struct {
	ID        string     `json:"id"`
	Owner     string     `json:"owner,omitempty"`
	Name      string     `json:"name"`
	Path      string     `json:"path"`   // absolute
	Source    string     `json:"source"` // "local" | "git"
	Git       *GitConfig `json:"git,omitempty"`
	Published bool       `json:"published"`
	CreatedAt int64      `json:"createdAt"`
}

// GitConfig is set on a "git" project. Secret is an InfraKit Vault secret id
// (an https token or an ssh key) — never the credential itself.
type GitConfig struct {
	URL      string `json:"url"`
	Ref      string `json:"ref,omitempty"` // branch / tag / sha; "" = default branch
	Secret   string `json:"secret,omitempty"`
	LastSync int64  `json:"lastSync,omitempty"`
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
	ProjectID        string `json:"projectId"`
	JobID            string `json:"jobId,omitempty"` // set when a saved Job launched this run
	RequiresApproval bool   `json:"requiresApproval,omitempty"`
	Playbook         string `json:"playbook"` // relative to the project
	Inventory        string `json:"inventory,omitempty"`
	Limit            string `json:"limit,omitempty"`
	Tags             string `json:"tags,omitempty"`
	SkipTags         string `json:"skipTags,omitempty"`
	ExtraVars        string `json:"extraVars,omitempty"` // YAML/JSON blob → -e @file
	Check            bool   `json:"check,omitempty"`
	Diff             bool   `json:"diff,omitempty"`
	Become           bool   `json:"become,omitempty"`
	Verbosity        int    `json:"verbosity,omitempty"` // 0..4 → -v..-vvvv
	Forks            int    `json:"forks,omitempty"`
}

// Job is a saved run configuration (the AWX "Job Template" / Semaphore "Task
// Template"). Running a Job produces a Run. AN1: local, owner-scoped;
// surveys + approval land in AN4/AN5.
type Job struct {
	ID        string `json:"id"`
	Owner     string `json:"owner,omitempty"`
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
	Playbook  string `json:"playbook"`
	Inventory string `json:"inventory,omitempty"`
	Limit     string `json:"limit,omitempty"`
	Tags      string `json:"tags,omitempty"`
	SkipTags  string `json:"skipTags,omitempty"`
	ExtraVars string `json:"extraVars,omitempty"`
	Check     bool   `json:"check,omitempty"`
	Diff      bool   `json:"diff,omitempty"`
	Become    bool   `json:"become,omitempty"`
	Verbosity int    `json:"verbosity,omitempty"`
	Forks     int    `json:"forks,omitempty"`
	// SurveySchema is a FormFlow schema (JSON) shown before a run; its answers
	// are merged into extra-vars. AN4c.
	SurveySchema string `json:"surveySchema,omitempty"`
	// RequiresApproval gates a run behind a second operator's OK (AN5, U3).
	RequiresApproval bool  `json:"requiresApproval,omitempty"`
	Published        bool  `json:"published"`
	CreatedAt        int64 `json:"createdAt"`
}

// Spec turns a Job into a RunSpec.
func (j Job) Spec() RunSpec {
	return RunSpec{
		ProjectID: j.ProjectID, JobID: j.ID, Playbook: j.Playbook, Inventory: j.Inventory,
		Limit: j.Limit, Tags: j.Tags, SkipTags: j.SkipTags, ExtraVars: j.ExtraVars,
		Check: j.Check, Diff: j.Diff, Become: j.Become, Verbosity: j.Verbosity, Forks: j.Forks,
		RequiresApproval: j.RequiresApproval,
	}
}

// Run is one recorded execution.
type Run struct {
	ID          int64  `json:"id"`
	Owner       string `json:"owner,omitempty"`
	ProjectID   string `json:"projectId"`
	JobID       string `json:"jobId,omitempty"`
	Playbook    string `json:"playbook"`
	Status      string `json:"status"`           // running | ok | failed | unreachable | cancelled
	Argv        string `json:"argv"`             // redacted
	Events      string `json:"events,omitempty"` // newline-delimited JSON, for replay
	Recap       string `json:"recap,omitempty"`  // JSON: host → counts
	TriggeredBy string `json:"triggeredBy"`
	StartedAt   int64  `json:"startedAt"`
	FinishedAt  int64  `json:"finishedAt"`
}

// Schedule cron-fires a Job. AN4b — self-contained, reuses the orchestrator's
// cron parser (no new dep).
type Schedule struct {
	ID      string `json:"id"`
	Owner   string `json:"owner,omitempty"`
	JobID   string `json:"jobId"`
	Name    string `json:"name"`
	Cron    string `json:"cron"` // 5-field, or @daily etc
	Enabled bool   `json:"enabled"`
	// RunOnStart fires the schedule once on scheduler start regardless of cron
	// timing (the desktop "morning check"); no missed windows are replayed.
	RunOnStart bool   `json:"runOnStart,omitempty"`
	NextRunAt  int64  `json:"nextRunAt"`
	LastRunAt  int64  `json:"lastRunAt"`
	LastStatus string `json:"lastStatus,omitempty"`
	LastRunID  int64  `json:"lastRunId,omitempty"`
	LastError  string `json:"lastError,omitempty"`
	CreatedAt  int64  `json:"createdAt"`
}

const (
	StatusRunning          = "running"
	StatusOK               = "ok"
	StatusFailed           = "failed"
	StatusUnreachable      = "unreachable"
	StatusCancelled        = "cancelled"
	StatusAwaitingApproval = "awaiting_approval"
	// StatusInterrupted marks a run whose backend process died mid-flight
	// (distinct from a user cancel). Set by boot recovery.
	StatusInterrupted = "interrupted"
)
