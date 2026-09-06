package ansible

import (
	"context"
	"errors"

	"github.com/infrakit/backend/internal/runstream"
)

// ErrNoHub is returned by the StartBackground entrypoints when the engine has
// no run hub wired (SetHub was never called).
var ErrNoHub = errors.New("run hub not configured")

// SetHub wires the background-run registry. Called once from main.go. When set,
// the API layer starts runs via StartBackground / StartAdhocBackground so a run
// outlives the HTTP request that began it. See BACKGROUND_RUNS_PLAN.md.
func (e *Engine) SetHub(h *runstream.Hub) { e.hub = h }

// HasHub reports whether background runs are available.
func (e *Engine) HasHub() bool { return e.hub != nil }

const runModule = "ansible"

// runKey is the hub key for an ansible run row.
func runKey(id int64) runstream.Key { return runstream.Key{Module: runModule, ID: id} }

// launch registers key with the hub under a fresh, request-independent context
// and runs exec in a goroutine. The run's terminal status is read back from the
// store (exec already recorded it) and reported to the hub.
func (e *Engine) launch(key runstream.Key, owner, target string, exec func(ctx context.Context, emit Emitter)) error {
	ctx, cancel := context.WithCancel(context.Background())
	emit, err := e.hub.Start(key, runstream.Meta{Owner: owner, Target: target}, cancel)
	if err != nil {
		cancel()
		_ = e.store.FinishRun(key.ID, StatusFailed, "", "")
		return err
	}
	go func() {
		defer cancel()
		exec(ctx, emit)
		status := StatusFailed
		if run, gerr := e.store.GetRun(owner, key.ID); gerr == nil && run != nil {
			status = run.Status
		}
		e.hub.Finish(key, status)
	}()
	return nil
}

// StartBackground validates spec, inserts the run row, and executes the run in
// the background wired to the hub. Returns the run id immediately. Watch it via
// GET /runs/ansible/{id}/stream; cancel via POST /runs/ansible/{id}/cancel.
func (e *Engine) StartBackground(owner string, mode RuntimeMode, triggeredBy string, spec RunSpec) (int64, error) {
	if e.hub == nil {
		return 0, ErrNoHub
	}
	pr, err := e.prepareRun(owner, triggeredBy, spec)
	if err != nil {
		return 0, err
	}
	err = e.launch(runKey(pr.runID), owner, spec.Playbook, func(ctx context.Context, emit Emitter) {
		emit("run-start", map[string]any{"runId": pr.runID, "argv": pr.redArgv})
		e.executeRun(ctx, mode, pr, emit)
	})
	if err != nil {
		return 0, err
	}
	return pr.runID, nil
}

// StartAdhocBackground is StartBackground for an ad-hoc module run.
func (e *Engine) StartAdhocBackground(owner string, _ RuntimeMode, spec AdhocSpec) (int64, error) {
	if e.hub == nil {
		return 0, ErrNoHub
	}
	pr, pre, err := e.prepareAdhoc(owner, spec)
	if err != nil {
		return 0, err
	}
	target := "(ad-hoc) " + nz(spec.Module, "command")
	err = e.launch(runKey(pr.runID), owner, target, func(ctx context.Context, emit Emitter) {
		emit("run-start", map[string]any{"runId": pr.runID, "argv": pr.redArgv})
		e.executeAdhoc(ctx, pr, pre, emit)
	})
	if err != nil {
		return 0, err
	}
	return pr.runID, nil
}

// Cancel asks the hub to cancel an in-flight run. Returns false if it isn't
// active (already finished, or never started here).
func (e *Engine) Cancel(id int64) bool {
	if e.hub == nil {
		return false
	}
	return e.hub.Cancel(runKey(id))
}
