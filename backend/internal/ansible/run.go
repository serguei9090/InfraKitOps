package ansible

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/infrakit/backend/internal/sse"
)

// Engine runs playbooks and records them.
type Engine struct {
	store  *Store
	rt     *Runtime
	cfgDir string
	cbDir  string // materialized callback plugin dir

	apprMu   sync.Mutex
	approves map[int64]pendingApproval
}

type pendingApproval struct {
	ch        chan bool
	requester string
}

// approvalTimeout is how long a run waits for a second operator's decision.
const approvalTimeout = 30 * time.Minute

// NewEngine wires the engine. cfgDir is the InfraKit config dir (for the
// callback plugin + venv).
func NewEngine(store *Store, rt *Runtime, cfgDir string) (*Engine, error) {
	cb, err := callbackDir(cfgDir)
	if err != nil {
		return nil, err
	}
	return &Engine{store: store, rt: rt, cfgDir: cfgDir, cbDir: cb, approves: map[int64]pendingApproval{}}, nil
}

// activeRunner resolves the Runner for the configured RuntimeMode (AN6).
func (e *Engine) activeRunner(ctx context.Context) Runner {
	return pickRunner(ctx, e.rt, e.cfgDir, e.store.GetSettings())
}

var errApproveSelf = errors.New("a run must be approved by a different operator")

// ErrApproveSelf is exported for the handler to map to a 403.
func ErrApproveSelf() error { return errApproveSelf }

// awaitRunApproval blocks until a different operator approves runID, the
// timeout elapses, or ctx ends. Returns true only on an explicit approval.
func (e *Engine) awaitRunApproval(ctx context.Context, runID int64, requester string) bool {
	ch := make(chan bool, 1)
	e.apprMu.Lock()
	e.approves[runID] = pendingApproval{ch: ch, requester: requester}
	e.apprMu.Unlock()
	defer func() {
		e.apprMu.Lock()
		delete(e.approves, runID)
		e.apprMu.Unlock()
	}()
	select {
	case ok := <-ch:
		return ok
	case <-time.After(approvalTimeout):
		return false
	case <-ctx.Done():
		return false
	}
}

// ResumeRun delivers an approver's decision for a parked run.
func (e *Engine) ResumeRun(runID int64, approverID string, approved bool) error {
	e.apprMu.Lock()
	p, ok := e.approves[runID]
	e.apprMu.Unlock()
	if !ok {
		return ErrNotFound
	}
	if approverID != "" && approverID == p.requester {
		return errApproveSelf
	}
	select {
	case p.ch <- approved:
		return nil
	default:
		return ErrNotFound
	}
}

// verbFlag turns 0..4 into "", "-v", ... "-vvvv".
func verbFlag(n int) string {
	if n <= 0 {
		return ""
	}
	if n > 4 {
		n = 4
	}
	return "-" + strings.Repeat("v", n)
}

// argv builds the ansible-playbook argument list (playbook path is validated
// by the caller to be inside the project).
func (e *Engine) argv(spec RunSpec, playbookAbs string) []string {
	a := []string{playbookAbs}
	if spec.Inventory != "" {
		a = append(a, "-i", spec.Inventory)
	}
	if spec.Limit != "" {
		a = append(a, "--limit", spec.Limit)
	}
	if spec.Tags != "" {
		a = append(a, "--tags", spec.Tags)
	}
	if spec.SkipTags != "" {
		a = append(a, "--skip-tags", spec.SkipTags)
	}
	if spec.Check {
		a = append(a, "--check")
	}
	if spec.Diff {
		a = append(a, "--diff")
	}
	if spec.Become {
		a = append(a, "--become")
	}
	if spec.Forks > 0 {
		a = append(a, "--forks", fmt.Sprint(spec.Forks))
	}
	if v := verbFlag(spec.Verbosity); v != "" {
		a = append(a, v)
	}
	return a
}

// Run executes spec, streaming SSE events, and records the run. Returns the
// run id. `mode` is the resolved runtime mode.
func (e *Engine) Run(ctx context.Context, owner string, mode RuntimeMode, triggeredBy string, spec RunSpec, out chan<- sse.Message) int64 {
	send := func(ev string, data any) {
		select {
		case out <- sse.Message{Event: ev, Data: data}:
		case <-ctx.Done():
		}
	}

	proj, err := e.store.GetProject(owner, spec.ProjectID)
	if err != nil {
		send("error", map[string]string{"error": "project not found"})
		return 0
	}
	playbookAbs, err := safeJoin(proj.Path, spec.Playbook)
	if err != nil {
		send("error", map[string]string{"error": "bad playbook path"})
		return 0
	}

	args := e.argv(spec, playbookAbs)
	redArgv := "ansible-playbook " + strings.Join(args, " ")
	run := &Run{
		Owner: owner, ProjectID: proj.ID, JobID: spec.JobID, Playbook: spec.Playbook, Status: StatusRunning,
		Argv: redArgv, TriggeredBy: nz(triggeredBy, "local"), StartedAt: time.Now().UnixMilli(),
	}
	runID, _ := e.store.InsertRun(run)
	send("run-start", map[string]any{"runId": runID, "argv": redArgv})

	// U3 gate — parks before touching the runtime so approval doesn't need
	// ansible to be present.
	if !e.gate(ctx, runID, run, spec.RequiresApproval, out) {
		return runID
	}

	runner := e.activeRunner(ctx)

	fail := func(msg string) int64 {
		_ = e.store.FinishRun(runID, StatusFailed, "", "")
		send("error", map[string]string{"error": msg})
		send("run-end", map[string]any{"runId": runID, "status": StatusFailed})
		return runID
	}

	// extra-vars → a temp file passed as -e @file (in the runner's shared tmp)
	if strings.TrimSpace(spec.ExtraVars) != "" {
		if f, ferr := os.CreateTemp(runner.TempDir(), "infrakit-extravars-*.yml"); ferr == nil {
			_, _ = f.WriteString(spec.ExtraVars)
			_ = f.Close()
			args = append(args, "-e", "@"+f.Name())
			defer os.Remove(f.Name())
		}
	}

	// the callback writes NDJSON events here
	evFile, everr := os.CreateTemp(runner.TempDir(), "infrakit-ansible-events-*.ndjson")
	if everr != nil {
		return fail(everr.Error())
	}
	evPath := evFile.Name()
	_ = evFile.Close()
	defer os.Remove(evPath)

	cmd, cerr := runner.Command(ctx, "ansible-playbook", proj.Path, args, e.callbackEnv(evPath))
	if cerr != nil {
		return fail(cerr.Error())
	}
	return e.execRun(ctx, cmd, evPath, run, runID, nil, out)
}

// callbackEnv is the environment that enables the streaming callback plugin and
// points it at the NDJSON event file. Runners translate the paths.
func (e *Engine) callbackEnv(eventFile string) []string {
	return []string{
		"ANSIBLE_CALLBACK_PLUGINS=" + e.cbDir,
		"ANSIBLE_CALLBACKS_ENABLED=infrakit_events",
		"ANSIBLE_LOAD_CALLBACK_PLUGINS=1",
		"INFRAKIT_EVENT_FILE=" + eventFile,
	}
}

// gate blocks a real multi-user run until a second operator approves it.
// Returns false when the run was denied (already recorded + run-end sent).
func (e *Engine) gate(ctx context.Context, runID int64, run *Run, requires bool, out chan<- sse.Message) bool {
	if !requires || run.Owner == "" || run.TriggeredBy == "schedule" {
		return true
	}
	send := func(ev string, data any) {
		select {
		case out <- sse.Message{Event: ev, Data: data}:
		case <-ctx.Done():
		}
	}
	run.Status = StatusAwaitingApproval
	_ = e.store.setRunStatus(runID, StatusAwaitingApproval)
	send("approval-required", map[string]any{"runId": runID, "requestedBy": run.Owner})
	if !e.awaitRunApproval(ctx, runID, run.Owner) {
		run.Status = StatusCancelled
		_ = e.store.FinishRun(runID, StatusCancelled, "", "")
		send("run-end", map[string]any{"runId": runID, "status": StatusCancelled, "reason": "not approved"})
		return false
	}
	run.Status = StatusRunning
	_ = e.store.setRunStatus(runID, StatusRunning)
	send("approval-granted", map[string]any{"runId": runID})
	return true
}

// execRun spawns `cmd` for an already-recorded run (`runID`, run-start already
// sent), tails the callback event file at `evPath`, and streams to `out` as
// SSE. `preEvents` are synthetic events (ad-hoc uses them for a play + task
// node). Returns runID.
func (e *Engine) execRun(
	ctx context.Context, cmd *exec.Cmd, evPath string, run *Run, runID int64,
	preEvents []map[string]any, out chan<- sse.Message,
) int64 {
	send := func(ev string, data any) {
		select {
		case out <- sse.Message{Event: ev, Data: data}:
		case <-ctx.Done():
		}
	}

	var events strings.Builder
	for _, ev := range preEvents {
		if b, err := json.Marshal(ev); err == nil {
			events.Write(b)
			events.WriteByte('\n')
		}
		name, _ := ev["e"].(string)
		send("ansible-"+strings.ReplaceAll(name, "_", "-"), ev)
	}

	var recap json.RawMessage
	tailDone := make(chan struct{})
	go func() {
		defer close(tailDone)
		e.tailEvents(ctx, evPath, func(line string, obj map[string]any) {
			events.WriteString(line)
			events.WriteByte('\n')
			ev, _ := obj["e"].(string)
			if ev == "stats" {
				if b, mErr := json.Marshal(obj); mErr == nil {
					recap = b
				}
			}
			send("ansible-"+strings.ReplaceAll(ev, "_", "-"), obj)
		})
	}()

	runErr := runStreaming(cmd,
		func(l string) { send("stdout", map[string]string{"text": l}) },
		func(l string) { send("stderr", map[string]string{"text": l}) },
	)
	<-tailDone

	status := StatusOK
	switch {
	case ctx.Err() != nil:
		status = StatusCancelled
	case runErr != nil:
		status = classifyExit(runErr, events.String())
	}
	run.Status = status
	run.FinishedAt = time.Now().UnixMilli()
	_ = e.store.FinishRun(runID, status, events.String(), string(recap))

	send("run-end", map[string]any{"runId": runID, "status": status})
	return runID
}

// tailEvents polls the NDJSON file until ctx is done, calling `emit` for each
// new complete line. The callback opens the file lazily, so we tolerate it
// not existing yet.
func (e *Engine) tailEvents(ctx context.Context, path string, emit func(line string, obj map[string]any)) {
	var offset int64
	tick := time.NewTicker(200 * time.Millisecond)
	defer tick.Stop()
	drain := func() {
		f, err := os.Open(path)
		if err != nil {
			return
		}
		defer f.Close()
		if _, err := f.Seek(offset, 0); err != nil {
			return
		}
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 64<<10), 8<<20)
		for sc.Scan() {
			line := sc.Text()
			offset += int64(len(line)) + 1
			var obj map[string]any
			if json.Unmarshal([]byte(line), &obj) == nil {
				emit(line, obj)
			}
		}
	}
	for {
		select {
		case <-ctx.Done():
			drain() // final flush
			return
		case <-tick.C:
			drain()
		}
	}
}

// classifyExit maps ansible-playbook's exit to a run status. Exit 4 = some
// hosts unreachable; 2 = failed tasks; others = failed.
func classifyExit(err error, events string) string {
	var ee *exec.ExitError
	if ok := asExit(err, &ee); ok {
		if ee.ExitCode() == 4 || strings.Contains(events, `"e":"runner_unreachable"`) {
			if !strings.Contains(events, `"e":"runner_failed"`) {
				return StatusUnreachable
			}
		}
	}
	return StatusFailed
}

func asExit(err error, target **exec.ExitError) bool {
	for err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			*target = ee
			return true
		}
		type unwrap interface{ Unwrap() error }
		u, ok := err.(unwrap)
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}

func nz(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

// baseEnv is the environment shared by every ansible* spawn — the parent env
// plus deterministic, colour-free output.
func baseEnv() []string {
	return append(os.Environ(),
		"ANSIBLE_FORCE_COLOR=0",
		"ANSIBLE_NOCOLOR=1",
		"PYTHONUNBUFFERED=1",
	)
}

// SafeJoin is the exported form of safeJoin for callers outside the package
// (the API layer's project-file endpoints).
func SafeJoin(root, rel string) (string, error) { return safeJoin(root, rel) }

// safeJoin joins rel onto root and refuses anything that escapes root.
func safeJoin(root, rel string) (string, error) {
	clean := filepath.Clean(filepath.Join(root, rel))
	rootClean := filepath.Clean(root)
	if clean != rootClean && !strings.HasPrefix(clean, rootClean+string(os.PathSeparator)) {
		return "", ErrOutsideRoot
	}
	return clean, nil
}
