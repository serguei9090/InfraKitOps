// Package orchestrator is the Runbooks engine: runbook storage (SQLite),
// argument resolution, the destructive-pattern scan, and step execution over
// SSE. See RUNBOOK_MODULE_PLAN.md §4-§6.
package orchestrator

import "github.com/infrakit/backend/internal/executor"

// ArgType constrains how the UI collects a value and how the engine validates it.
type ArgType string

const (
	ArgString    ArgType = "string"
	ArgNumber    ArgType = "number"
	ArgEnum      ArgType = "enum"
	ArgBoolean   ArgType = "boolean"
	ArgSecret    ArgType = "secret"
	ArgNode      ArgType = "node"
	ArgMultiline ArgType = "multiline"
)

// ArgSpec configures one {{NAME}} placeholder.
type ArgSpec struct {
	Name             string   `json:"name"`
	Label            string   `json:"label,omitempty"`
	Help             string   `json:"help,omitempty"`
	Type             ArgType  `json:"type"`
	Required         bool     `json:"required"`
	Default          string   `json:"default,omitempty"`
	EnumValues       []string `json:"enumValues,omitempty"`
	ValidationRegex  string   `json:"validationRegex,omitempty"`
	ValidationPreset string   `json:"validationPreset,omitempty"`
	ErrorMessage     string   `json:"errorMessage,omitempty"`
}

// StepSpec is one command in a runbook.
type StepSpec struct {
	ID              string        `json:"id"`
	Name            string        `json:"name"`
	Executor        executor.Kind `json:"executor"`
	Script          string        `json:"script"`
	TimeoutSec      int           `json:"timeoutSec,omitempty"`
	ContinueOnError bool          `json:"continueOnError"`
	RunIf           string        `json:"runIf,omitempty"` // "" | "always" | "prev-success" | "prev-failure"

	SSH    *SSHStep    `json:"ssh,omitempty"`    // R2
	HTTP   *HTTPStep   `json:"http,omitempty"`   // R2
	Python *PythonStep `json:"python,omitempty"` // R4
}

// PythonStep — R4. Extra config for a `python` executor step; the script itself
// stays in StepSpec.Script.
type PythonStep struct {
	Dependencies []string `json:"dependencies,omitempty"`
	PyVersion    string   `json:"pyVersion,omitempty"`
}

// SSHStep — R2.
type SSHStep struct {
	NodeID       string `json:"nodeId,omitempty"`
	InlineHost   string `json:"inlineHost,omitempty"`
	User         string `json:"user,omitempty"`
	AuthSecretID string `json:"authSecretId,omitempty"`
	Sudo         bool   `json:"sudo,omitempty"`
	JumpNodeID   string `json:"jumpNodeId,omitempty"`
}

// HTTPStep — R2.
type HTTPStep struct {
	Method       string            `json:"method"`
	URL          string            `json:"url"`
	Headers      []KV              `json:"headers,omitempty"`
	Body         string            `json:"body,omitempty"`
	Auth         *HTTPAuth         `json:"auth,omitempty"`
	ExpectStatus []int             `json:"expectStatus,omitempty"`
	Assert       []HTTPAssert      `json:"assert,omitempty"`
	Extra        map[string]string `json:"-"`
}

type KV struct {
	K string `json:"k"`
	V string `json:"v"`
}
type HTTPAuth struct {
	Kind     string `json:"kind"` // "bearer" | "basic"
	SecretID string `json:"secretId"`
}
type HTTPAssert struct {
	JSONPath string `json:"jsonpath"`
	Equals   string `json:"equals"`
}

// Spec is the versioned payload of a runbook.
type Spec struct {
	Name                string     `json:"name"`
	Description          string     `json:"description,omitempty"`
	DetailedDescription  string     `json:"detailedDescription,omitempty"`
	DefaultTimeoutSec    int        `json:"defaultTimeoutSec"`
	Tags                 []string   `json:"tags"`
	Args                 []ArgSpec  `json:"args"`
	Steps                []StepSpec `json:"steps"`
}

// Version is an immutable saved snapshot.
type Version struct {
	Version   int    `json:"version"`
	CreatedAt int64  `json:"createdAt"`
	Note      string `json:"note,omitempty"`
	Pinned    bool   `json:"pinned,omitempty"`
	Spec      Spec   `json:"spec"`
}

// Runbook is the top-level record.
type Runbook struct {
	ID        string    `json:"id"`
	Slug      string    `json:"slug"`
	Published bool      `json:"published"`
	Versions  []Version `json:"versions"`
	Draft     *Spec     `json:"draft"`
	CreatedAt int64     `json:"createdAt"`
	UpdatedAt int64     `json:"updatedAt"`
}

// currentSpec is the draft if present, else the latest version's spec.
func (rb *Runbook) currentSpec() *Spec {
	if rb.Draft != nil {
		return rb.Draft
	}
	if v := rb.latest(); v != nil {
		return &v.Spec
	}
	return nil
}

func (rb *Runbook) latest() *Version {
	var out *Version
	for i := range rb.Versions {
		if out == nil || rb.Versions[i].Version > out.Version {
			out = &rb.Versions[i]
		}
	}
	return out
}

func (rb *Runbook) nextVersion() int {
	n := 0
	for _, v := range rb.Versions {
		if v.Version > n {
			n = v.Version
		}
	}
	return n + 1
}

func (rb *Runbook) version(n int) *Spec {
	for i := range rb.Versions {
		if rb.Versions[i].Version == n {
			return &rb.Versions[i].Spec
		}
	}
	return nil
}

// SSHNode is a saved remote target (R2 uses it; R0 stores/serves it).
type SSHNode struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Host       string   `json:"host"`
	Port       int      `json:"port"`
	User       string   `json:"user"`
	AuthKind   string   `json:"authKind"` // "password" | "key" | "agent"
	AuthSecret string   `json:"authSecretId,omitempty"`
	JumpNodeID string   `json:"jumpNodeId,omitempty"`
	HostKeyFP  string   `json:"hostKeyFp,omitempty"`
	Tags       []string `json:"tags"`
	CreatedAt  int64    `json:"createdAt"`
}

// RunSchedule fires a runbook on a cron expression (R4b). Only published
// runbooks are run on a schedule.
type RunSchedule struct {
	ID         string            `json:"id"`
	RunbookID  string            `json:"runbookId"`
	Cron       string            `json:"cron"`
	Enabled    bool              `json:"enabled"`
	Version    int               `json:"version"` // 0 = latest published
	Args       map[string]string `json:"args"`
	NextRunAt  int64             `json:"nextRunAt"`
	LastRunAt  int64             `json:"lastRunAt"`
	LastStatus string            `json:"lastStatus,omitempty"`
	LastRunID  int64             `json:"lastRunId,omitempty"`
	LastError  string            `json:"lastError,omitempty"`
	CreatedAt  int64             `json:"createdAt"`
}

// RunStatus values.
const (
	StatusRunning = "running"
	StatusOK      = "ok"
	StatusFailed  = "failed"
	StatusPartial = "partial"
)

// RunStep is one executed step recorded in history.
type RunStep struct {
	Index            int    `json:"index"`
	Name             string `json:"name"`
	Executor         string `json:"executor"`
	Target           string `json:"target,omitempty"`
	CommandRedacted  string `json:"commandRedacted"`
	Stdout           string `json:"stdout"`
	Stderr           string `json:"stderr"`
	ExitCode         int    `json:"exitCode"`
	Status           string `json:"status"`
	StartedAt        int64  `json:"startedAt"`
	FinishedAt       int64  `json:"finishedAt"`
}

// Run is one execution recorded in history.
type Run struct {
	ID             int64             `json:"id"`
	RunbookID      string            `json:"runbookId"`
	RunbookVersion int               `json:"runbookVersion"`
	Status         string            `json:"status"`
	DryRun         bool              `json:"dryRun"`
	TriggeredBy    string            `json:"triggeredBy"`
	StartedAt      int64             `json:"startedAt"`
	FinishedAt     int64             `json:"finishedAt"`
	Args           map[string]string `json:"args"` // secret-typed already replaced with ‹secret:NAME›
	Steps          []RunStep         `json:"steps"`
}
