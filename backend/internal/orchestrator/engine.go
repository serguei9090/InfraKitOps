package orchestrator

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/executor"
	"github.com/infrakit/backend/internal/sse"
)

// SecretResolver resolves a `{{secret:NAME}}` ref to its plaintext (the vault).
type SecretResolver interface {
	ResolveByName(name string) (string, error)
}

// Engine executes runbooks.
type Engine struct {
	Store   *Store
	Secrets SecretResolver
	// MaxConcurrent caps how many runs may be in flight (0 = unlimited).
	sem chan struct{}
}

// NewEngine builds an engine with a concurrency cap.
func NewEngine(store *Store, secrets SecretResolver, maxConcurrent int) *Engine {
	var sem chan struct{}
	if maxConcurrent > 0 {
		sem = make(chan struct{}, maxConcurrent)
	}
	return &Engine{Store: store, Secrets: secrets, sem: sem}
}

// ValidationError is one failed arg check.
type ValidationError struct {
	Arg     string `json:"arg"`
	Message string `json:"message"`
}

// Preview is the dry-run / confirm payload.
type Preview struct {
	Valid       bool               `json:"valid"`
	Validation  []ValidationError  `json:"validation"`
	Steps       []PreviewStep      `json:"steps"`
	Destructive []DestructiveMatch `json:"destructive"`
}

// PreviewStep is one step's resolved-and-redacted command.
type PreviewStep struct {
	Index    int    `json:"index"`
	Name     string `json:"name"`
	Executor string `json:"executor"`
	Command  string `json:"command"` // secrets shown as ‹secret:NAME›
}

var presetRe = map[string]*regexp.Regexp{
	"ipv4":      regexp.MustCompile(`^(\d{1,3}\.){3}\d{1,3}$`),
	"hostname":  regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$`),
	"port":      regexp.MustCompile(`^\d{1,5}$`),
	"k8s-name":  regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`),
	"slug":      regexp.MustCompile(`^[a-z0-9-]+$`),
	"path-unix": regexp.MustCompile(`^(/[^/\0]+)+/?$`),
}

// validate checks every arg value against its spec.
func validate(spec *Spec, values map[string]string) []ValidationError {
	var out []ValidationError
	for _, a := range spec.Args {
		v, ok := values[a.Name]
		v = strings.TrimSpace(v)
		if a.Required && (!ok || v == "") {
			out = append(out, ValidationError{a.Name, msgOr(a, a.Label+" is required")})
			continue
		}
		if v == "" {
			continue
		}
		switch a.Type {
		case ArgNumber:
			if _, err := strconv.ParseFloat(v, 64); err != nil {
				out = append(out, ValidationError{a.Name, msgOr(a, a.Name+" must be a number")})
			}
		case ArgEnum:
			if len(a.EnumValues) > 0 && !contains(a.EnumValues, v) {
				out = append(out, ValidationError{a.Name, msgOr(a, a.Name+" must be one of: "+strings.Join(a.EnumValues, ", "))})
			}
		}
		if a.ValidationPreset != "" {
			if re, ok := presetRe[a.ValidationPreset]; ok && !re.MatchString(v) {
				out = append(out, ValidationError{a.Name, msgOr(a, a.Name+" is not a valid "+a.ValidationPreset)})
			}
		}
		if a.ValidationRegex != "" {
			re, err := regexp.Compile(a.ValidationRegex)
			if err == nil && !re.MatchString(v) {
				out = append(out, ValidationError{a.Name, msgOr(a, a.Name+" does not match the required pattern")})
			}
		}
	}
	return out
}

// resolveSpec picks the spec: a specific version, or the draft/latest.
func (e *Engine) resolveSpec(rb *Runbook, version int) (*Spec, int, error) {
	if version > 0 {
		sp := rb.version(version)
		if sp == nil {
			return nil, 0, ErrNotFound
		}
		return sp, version, nil
	}
	if l := rb.latest(); l != nil {
		return &l.Spec, l.Version, nil
	}
	if rb.Draft != nil {
		return rb.Draft, 0, nil
	}
	return nil, 0, ErrNotFound
}

// BuildPreview resolves + validates + scans without executing.
func (e *Engine) BuildPreview(rb *Runbook, version int, values map[string]string) (Preview, *Spec, int, error) {
	spec, ver, err := e.resolveSpec(rb, version)
	if err != nil {
		return Preview{}, nil, 0, err
	}
	p := Preview{Validation: validate(spec, values)}
	p.Valid = len(p.Validation) == 0

	resolver := func(name string) (string, error) {
		if e.Secrets == nil {
			return "", fmt.Errorf("vault unavailable")
		}
		return e.Secrets.ResolveByName(name)
	}
	for i, st := range spec.Steps {
		rendered, secretNames := Render(st.Script, Values{Args: values, ResolveSecret: resolver})
		redacted := rendered
		for name := range secretNames {
			if val, err := resolver(name); err == nil {
				redacted = strings.ReplaceAll(redacted, val, "‹secret:"+name+"›")
			}
		}
		p.Steps = append(p.Steps, PreviewStep{
			Index: i + 1, Name: stepName(st, i), Executor: string(st.Executor), Command: redacted,
		})
		p.Destructive = append(p.Destructive, ScanDestructive(rendered)...)
	}
	return p, spec, ver, nil
}

// Run executes a runbook, streaming events. Blocks until the run finishes or
// ctx is cancelled. Returns the run id (0 for a dry run).
func (e *Engine) Run(ctx context.Context, rb *Runbook, version int, values map[string]string, dryRun bool, out chan<- sse.Message) int64 {
	preview, spec, ver, err := e.BuildPreview(rb, version, values)
	if err != nil {
		out <- sse.Message{Event: "error", Data: map[string]string{"error": err.Error()}}
		return 0
	}
	if !preview.Valid {
		out <- sse.Message{Event: "error", Data: map[string]any{"error": "validation failed", "validation": preview.Validation}}
		return 0
	}
	out <- sse.Message{Event: "preview", Data: preview}

	if dryRun {
		out <- sse.Message{Event: "run-end", Data: map[string]any{"status": "ok", "dryRun": true}}
		return 0
	}
	if !rb.Published {
		// R0/R1: a draft/unpublished runbook is still runnable by its author.
		// The published gate is enforced at the API layer per-caller in R1.
	}

	if e.sem != nil {
		select {
		case e.sem <- struct{}{}:
			defer func() { <-e.sem }()
		case <-ctx.Done():
			return 0
		}
	}

	resolver := func(name string) (string, error) {
		if e.Secrets == nil {
			return "", fmt.Errorf("vault is locked or unavailable")
		}
		return e.Secrets.ResolveByName(name)
	}

	run := &Run{
		RunbookID: rb.ID, RunbookVersion: ver, Status: StatusRunning, DryRun: false,
		TriggeredBy: "local", StartedAt: time.Now().UnixMilli(),
		Args: redactArgValues(spec, values), Steps: []RunStep{},
	}
	runID, _ := e.Store.InsertRun(run)
	out <- sse.Message{Event: "run-start", Data: map[string]any{"runId": runID, "steps": len(spec.Steps)}}

	overall := StatusOK
	var prev *RunStep
	for i, st := range spec.Steps {
		if !shouldRun(st, prev) {
			rs := RunStep{Index: i + 1, Name: stepName(st, i), Executor: string(st.Executor), Status: "skipped", StartedAt: time.Now().UnixMilli(), FinishedAt: time.Now().UnixMilli()}
			run.Steps = append(run.Steps, rs)
			out <- sse.Message{Event: "step-end", Data: rs}
			prev = &run.Steps[len(run.Steps)-1]
			continue
		}

		rendered, secretNames := Render(st.Script, Values{Args: values, Steps: run.Steps, ResolveSecret: resolver})
		secretVals := map[string]string{}
		for name := range secretNames {
			if v, err := resolver(name); err == nil {
				secretVals[name] = v
			}
		}

		rs := RunStep{Index: i + 1, Name: stepName(st, i), Executor: string(st.Executor), StartedAt: time.Now().UnixMilli()}
		rs.CommandRedacted = Redact(rendered, secretVals)
		out <- sse.Message{Event: "step-start", Data: map[string]any{"index": rs.Index, "name": rs.Name, "executor": rs.Executor, "command": rs.CommandRedacted}}

		ex := executor.For(st.Executor)
		if ex == nil {
			rs.Status = "failed"
			rs.Stderr = "executor '" + string(st.Executor) + "' is not available on this host"
			rs.ExitCode = -1
		} else {
			stepCtx, cancel := context.WithTimeout(ctx, stepTimeout(st, spec))
			sw := &redactWriter{out: out, event: "stdout", secrets: secretVals}
			ew := &redactWriter{out: out, event: "stderr", secrets: secretVals}
			res := ex.Run(stepCtx, executor.Step{Kind: st.Executor, Script: rendered}, sw, ew)
			cancel()
			rs.ExitCode = res.ExitCode
			rs.Stdout = Redact(res.Stdout, secretVals)
			rs.Stderr = Redact(res.Stderr, secretVals)
			if res.Err != "" {
				rs.Stderr = strings.TrimSpace(rs.Stderr + "\n" + res.Err)
			}
			if res.ExitCode == 0 {
				rs.Status = StatusOK
			} else {
				rs.Status = StatusFailed
			}
		}
		rs.FinishedAt = time.Now().UnixMilli()
		run.Steps = append(run.Steps, rs)
		prev = &run.Steps[len(run.Steps)-1]
		out <- sse.Message{Event: "step-end", Data: rs}

		if rs.Status == StatusFailed {
			if st.ContinueOnError {
				overall = StatusPartial
			} else {
				overall = StatusFailed
				break
			}
		}
	}

	_ = e.Store.FinishRun(runID, overall, run.Steps)
	settings := e.Store.GetSettings()
	e.Store.PruneRuns(rb.ID, atoiOr(settings["historyRetentionDays"], 90), atoiOr(settings["historyMaxPerRunbook"], 20))
	out <- sse.Message{Event: "run-end", Data: map[string]any{"runId": runID, "status": overall}}
	return runID
}

// --- helpers ------------------------------------------------------------

type redactWriter struct {
	out     chan<- sse.Message
	event   string
	secrets map[string]string
}

func (w *redactWriter) Write(p []byte) (int, error) {
	text := Redact(string(p), w.secrets)
	w.out <- sse.Message{Event: w.event, Data: map[string]string{"text": text}}
	return len(p), nil
}

func shouldRun(st StepSpec, prev *RunStep) bool {
	switch st.RunIf {
	case "", "always":
		return true
	case "prev-success":
		return prev == nil || prev.Status == StatusOK
	case "prev-failure":
		return prev != nil && prev.Status == StatusFailed
	default:
		return true
	}
}

func stepTimeout(st StepSpec, spec *Spec) time.Duration {
	sec := st.TimeoutSec
	if sec == 0 {
		sec = spec.DefaultTimeoutSec
	}
	if sec <= 0 {
		return 24 * time.Hour // "unlimited"
	}
	return time.Duration(sec) * time.Second
}

func stepName(st StepSpec, i int) string {
	if st.Name != "" {
		return st.Name
	}
	return fmt.Sprintf("Step %d", i+1)
}

func redactArgValues(spec *Spec, values map[string]string) map[string]string {
	secret := map[string]bool{}
	for _, a := range spec.Args {
		if a.Type == ArgSecret {
			secret[a.Name] = true
		}
	}
	out := map[string]string{}
	for k, v := range values {
		if secret[k] {
			out[k] = "‹secret:" + k + "›"
		} else {
			out[k] = v
		}
	}
	return out
}

func msgOr(a ArgSpec, def string) string {
	if a.ErrorMessage != "" {
		return a.ErrorMessage
	}
	return def
}
func contains(ss []string, s string) bool {
	for _, x := range ss {
		if x == s {
			return true
		}
	}
	return false
}
func atoiOr(s string, def int) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return def
}
