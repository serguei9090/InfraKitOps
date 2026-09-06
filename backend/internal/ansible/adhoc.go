package ansible

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"
)

// AdhocSpec is one `ansible <pattern> -m <module> -a <args>` request.
type AdhocSpec struct {
	ProjectID string `json:"projectId"`
	Pattern   string `json:"pattern"` // host pattern, e.g. "all" / "web*"
	Module    string `json:"module"`  // -m, default "command"
	Args      string `json:"args"`    // -a
	Inventory string `json:"inventory,omitempty"`
	Become    bool   `json:"become,omitempty"`
	OneLine   bool   `json:"oneLine,omitempty"`
}

// prepareAdhoc validates spec, builds the argv, inserts the run row and returns
// the synthetic play + task events that make the tree render.
func (e *Engine) prepareAdhoc(owner string, spec AdhocSpec) (*preparedRun, []map[string]any, error) {
	proj, err := e.store.GetProject(owner, spec.ProjectID)
	if err != nil {
		return nil, nil, errors.New("project not found")
	}

	pattern := nz(spec.Pattern, "all")
	module := nz(spec.Module, "command")
	args := []string{pattern, "-m", module}
	if strings.TrimSpace(spec.Args) != "" {
		args = append(args, "-a", spec.Args)
	}
	if inv := strings.TrimSpace(spec.Inventory); inv != "" {
		if strings.Contains(inv, ",") {
			args = append(args, "-i", inv)
		} else if p, jerr := safeJoin(proj.Path, inv); jerr == nil {
			args = append(args, "-i", p)
		}
	}
	if spec.Become {
		args = append(args, "--become")
	}
	if spec.OneLine {
		args = append(args, "--one-line")
	}

	redArgv := "ansible " + strings.Join(args, " ")
	run := &Run{
		Owner: owner, ProjectID: proj.ID, Playbook: "(ad-hoc) " + module, Status: StatusRunning,
		Argv: redArgv, TriggeredBy: "adhoc", StartedAt: time.Now().UnixMilli(),
	}
	runID, err := e.store.InsertRun(run)
	if err != nil {
		return nil, nil, err
	}

	taskName := module
	if spec.Args != "" {
		taskName = module + " " + spec.Args
	}
	pre := []map[string]any{
		{"e": "play_start", "play": "ad-hoc: " + pattern, "hosts": []string{}},
		{"e": "task_start", "task": taskName, "action": module, "uuid": "adhoc-0"},
	}
	return &preparedRun{runID: runID, run: run, proj: proj, args: args, redArgv: redArgv}, pre, nil
}

// executeAdhoc runs a prepared ad-hoc run to completion.
func (e *Engine) executeAdhoc(ctx context.Context, pr *preparedRun, pre []map[string]any, emit Emitter) int64 {
	runner := e.activeRunner(ctx)

	evFile, everr := os.CreateTemp(runner.TempDir(), "infrakit-ansible-events-*.ndjson")
	if everr != nil {
		_ = e.store.FinishRun(pr.runID, StatusFailed, "", "")
		emit("error", map[string]string{"error": everr.Error()})
		emit("run-end", map[string]any{"runId": pr.runID, "status": StatusFailed})
		return pr.runID
	}
	evPath := evFile.Name()
	_ = evFile.Close()
	defer os.Remove(evPath)

	req := RunReq{
		Tool: "ansible", Dir: pr.proj.Path, Argv: pr.args,
		Env: append(e.callbackEnv(evPath), factCacheEnv(pr.proj.Path)...),
	}
	return e.execRun(ctx, runner, req, evPath, pr.run, pr.runID, pre, emit)
}

// RunAdhoc runs an ad-hoc module against a pattern synchronously, emitting SSE
// events the same way playbook runs do. The API layer uses StartAdhocBackground.
func (e *Engine) RunAdhoc(ctx context.Context, owner string, _ RuntimeMode, spec AdhocSpec, emit Emitter) int64 {
	pr, pre, err := e.prepareAdhoc(owner, spec)
	if err != nil {
		emit("error", map[string]string{"error": err.Error()})
		return 0
	}
	emit("run-start", map[string]any{"runId": pr.runID, "argv": pr.redArgv})
	return e.executeAdhoc(ctx, pr, pre, emit)
}
