package orchestrator

import (
	"context"
	"errors"

	"github.com/infrakit/backend/internal/runstream"
	"github.com/infrakit/backend/internal/userctx"
)

// ErrNoHub is returned by StartBackground when the engine has no run hub wired.
var ErrNoHub = errors.New("run hub not configured")

const runModule = "runbook"

func runKey(id int64) runstream.Key { return runstream.Key{Module: runModule, ID: id} }

// SetHub wires the background-run registry. Called once from main.go. When set,
// the API layer starts runs via StartBackground so a run outlives the HTTP
// request that began it. See BACKGROUND_RUNS_PLAN.md.
func (e *Engine) SetHub(h *runstream.Hub) { e.hub = h }

// HasHub reports whether background runs are available.
func (e *Engine) HasHub() bool { return e.hub != nil }

// StartBackground validates the runbook, inserts the run row and executes the
// run in the background wired to the hub. Returns the run id immediately. Watch
// it via GET /runs/runbook/{id}/stream; cancel via POST /runs/runbook/{id}/cancel.
func (e *Engine) StartBackground(ctx context.Context, rb *Runbook, version int, values map[string]string, triggeredBy string) (int64, error) {
	if e.hub == nil {
		return 0, ErrNoHub
	}

	// prepareRun emits preview + run-start; buffer those until the hub emit
	// exists (a few events, bounded by the runbook's arg + step count).
	var buffered []event
	capture := func(ev string, data any) { buffered = append(buffered, event{ev, data}) }
	pr, done := e.prepareRun(ctx, rb, version, values, false, triggeredBy, capture)
	if done || pr == nil {
		// preflight failure — surface the error to the caller
		for _, b := range buffered {
			if b.name == "error" {
				return 0, errFromEvent(b.data)
			}
		}
		return 0, errors.New("runbook run could not start")
	}

	owner := userctx.From(ctx)
	target := pr.spec.Name
	if target == "" {
		target = rb.Slug
	}
	key := runKey(pr.runID)
	// Detach from the request context but keep the caller's identity so
	// per-user lookups (SSH nodes, secrets) still resolve after the request ends.
	bg := userctx.With(context.Background(), owner)
	bg = userctx.WithRole(bg, userctx.Role(ctx))
	bg = userctx.WithName(bg, userctx.Name(ctx))
	runCtx, cancel := context.WithCancel(bg)
	emit, err := e.hub.Start(key, runstream.Meta{Owner: owner, Target: target}, cancel)
	if err != nil {
		cancel()
		_ = e.Store.FinishRun(pr.runID, StatusFailed, pr.run.Steps)
		return 0, err
	}
	for _, b := range buffered {
		emit(b.name, b.data)
	}
	go func() {
		defer cancel()
		e.executeRun(runCtx, pr, emit)
		status := StatusFailed
		if run, gerr := e.Store.GetRun(owner, pr.runID); gerr == nil && run != nil {
			status = run.Status
		}
		e.hub.Finish(key, status)
	}()
	return pr.runID, nil
}

// Cancel asks the hub to cancel an in-flight run.
func (e *Engine) Cancel(id int64) bool {
	if e.hub == nil {
		return false
	}
	return e.hub.Cancel(runKey(id))
}

type event struct {
	name string
	data any
}

func errFromEvent(data any) error {
	if m, ok := data.(map[string]string); ok && m["error"] != "" {
		return errors.New(m["error"])
	}
	if m, ok := data.(map[string]any); ok {
		if s, ok := m["error"].(string); ok {
			return errors.New(s)
		}
	}
	return errors.New("validation failed")
}
