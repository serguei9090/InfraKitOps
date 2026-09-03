package ansible

import (
	"context"
	"os"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/sse"
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

// RunAdhoc runs an ad-hoc module against a pattern, streaming SSE events the
// same way playbook runs do (with a synthetic play + task so the tree renders).
func (e *Engine) RunAdhoc(ctx context.Context, owner string, mode RuntimeMode, spec AdhocSpec, out chan<- sse.Message) int64 {
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
	runner := e.activeRunner(ctx)

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

	evFile, everr := os.CreateTemp(runner.TempDir(), "infrakit-ansible-events-*.ndjson")
	if everr != nil {
		send("error", map[string]string{"error": everr.Error()})
		return 0
	}
	evPath := evFile.Name()
	_ = evFile.Close()
	defer os.Remove(evPath)

	req := RunReq{Tool: "ansible", Dir: proj.Path, Argv: args, Env: e.callbackEnv(evPath)}

	redArgv := "ansible " + strings.Join(args, " ")
	run := &Run{
		Owner: owner, ProjectID: proj.ID, Playbook: "(ad-hoc) " + module, Status: StatusRunning,
		Argv: redArgv, TriggeredBy: "adhoc", StartedAt: time.Now().UnixMilli(),
	}
	runID, _ := e.store.InsertRun(run)
	send("run-start", map[string]any{"runId": runID, "argv": redArgv})

	taskName := module
	if spec.Args != "" {
		taskName = module + " " + spec.Args
	}
	pre := []map[string]any{
		{"e": "play_start", "play": "ad-hoc: " + pattern, "hosts": []string{}},
		{"e": "task_start", "task": taskName, "action": module, "uuid": "adhoc-0"},
	}
	return e.execRun(ctx, runner, req, evPath, run, runID, pre, out)
}
