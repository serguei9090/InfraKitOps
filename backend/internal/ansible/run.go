package ansible

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/sse"
)

// Engine runs playbooks and records them.
type Engine struct {
	store  *Store
	rt     *Runtime
	cfgDir string
	cbDir  string // materialized callback plugin dir
}

// NewEngine wires the engine. cfgDir is the InfraKit config dir (for the
// callback plugin + venv).
func NewEngine(store *Store, rt *Runtime, cfgDir string) (*Engine, error) {
	cb, err := callbackDir(cfgDir)
	if err != nil {
		return nil, err
	}
	return &Engine{store: store, rt: rt, cfgDir: cfgDir, cbDir: cb}, nil
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
	bin := e.rt.Bin(ctx, mode, "ansible-playbook")
	if bin == "" {
		send("error", map[string]string{"error": "ansible-playbook not available — check the Ansible runtime"})
		return 0
	}

	// extra-vars → a temp file passed as -e @file
	var extraVarsFile string
	args := e.argv(spec, playbookAbs)
	if strings.TrimSpace(spec.ExtraVars) != "" {
		f, ferr := os.CreateTemp("", "infrakit-extravars-*.yml")
		if ferr == nil {
			_, _ = f.WriteString(spec.ExtraVars)
			_ = f.Close()
			extraVarsFile = f.Name()
			args = append(args, "-e", "@"+extraVarsFile)
			defer os.Remove(extraVarsFile)
		}
	}

	// the callback writes NDJSON events here
	evFile, everr := os.CreateTemp("", "infrakit-ansible-events-*.ndjson")
	if everr != nil {
		send("error", map[string]string{"error": everr.Error()})
		return 0
	}
	evPath := evFile.Name()
	_ = evFile.Close()
	defer os.Remove(evPath)

	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = proj.Path
	cmd.Env = append(baseEnv(),
		"ANSIBLE_CALLBACK_PLUGINS="+e.cbDir,
		"ANSIBLE_CALLBACKS_ENABLED=infrakit_events",
		"ANSIBLE_LOAD_CALLBACK_PLUGINS=1",
		"INFRAKIT_EVENT_FILE="+evPath,
	)

	redArgv := "ansible-playbook " + strings.Join(args, " ")
	run := &Run{
		Owner: owner, ProjectID: proj.ID, JobID: spec.JobID, Playbook: spec.Playbook, Status: StatusRunning,
		Argv: redArgv, TriggeredBy: nz(triggeredBy, "local"), StartedAt: time.Now().UnixMilli(),
	}
	runID, _ := e.store.InsertRun(run)
	send("run-start", map[string]any{"runId": runID, "argv": redArgv})

	// tail the event file concurrently and forward parsed events
	var events strings.Builder
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

	// raw stdout/stderr for the Console toggle
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
