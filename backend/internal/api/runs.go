package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/ansible"
	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/orchestrator"
	"github.com/infrakit/backend/internal/runstream"
	"github.com/infrakit/backend/internal/sse"
)

// RunsHandlers wires the module-agnostic /runs/* endpoints for background runs:
// a run outlives the request that starts it and is watched via a replay+tail
// stream. See BACKGROUND_RUNS_PLAN.md. Nil Hub → every endpoint 503.
type RunsHandlers struct {
	Hub     *runstream.Hub
	Ansible *ansible.Store      // owner check + pre-hub history replay, module "ansible"
	Runbook *orchestrator.Store // owner check + pre-hub history replay, module "runbook"
}

func (h *RunsHandlers) ok() bool { return h != nil && h.Hub != nil }

// authorize reports whether the caller may view (module, id).
func (h *RunsHandlers) authorize(r *http.Request, module string, id int64) bool {
	switch module {
	case "ansible":
		if h.Ansible == nil {
			return false
		}
		_, err := h.Ansible.GetRun(owner(r), id)
		return err == nil
	case "runbook":
		if h.Runbook == nil {
			return false
		}
		_, err := h.Runbook.GetRun(owner(r), id)
		return err == nil
	default:
		return false
	}
}

// Active: GET /runs/active — the caller's in-flight runs, newest first.
func (h *RunsHandlers) Active(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		apierr.Write(w, apierr.Unavailable("background runs"))
		return
	}
	me := owner(r)
	out := make([]runstream.Info, 0)
	for _, in := range h.Hub.Active() {
		if in.Owner == "" || in.Owner == me {
			out = append(out, in)
		}
	}
	WriteJSON(w, http.StatusOK, map[string]any{"runs": out})
}

// Stream: GET /runs/{id}/stream?module= — replay the persisted event log, then
// tail live events. Closing the connection ends the view, not the run.
func (h *RunsHandlers) Stream(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		sse.RejectCoded(w, string(apierr.CodeInternal), "background runs are not available", "")
		return
	}
	module := r.URL.Query().Get("module")
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if !h.authorize(r, module, id) {
		sse.RejectCoded(w, string(apierr.CodeNotFound), "run not found", "")
		return
	}

	sw, err := sse.New(w)
	if err != nil {
		return
	}
	key := runstream.Key{Module: module, ID: id}
	ch := make(chan sse.Message, 256)
	if h.Hub.IsActive(key) || h.Hub.HasLog(key) {
		go h.Hub.Subscribe(r.Context(), key, ch)
	} else {
		go func() {
			defer close(ch)
			h.replayFromStore(r, module, id, ch)
		}()
	}
	sw.Pump(r.Context(), ch)
}

// replayFromStore rebuilds a finished run's stream from the module's own run
// table — for runs that predate the hub's on-disk log.
func (h *RunsHandlers) replayFromStore(r *http.Request, module string, id int64, ch chan<- sse.Message) {
	switch module {
	case "ansible":
		if h.Ansible == nil {
			return
		}
		run, err := h.Ansible.GetRun(owner(r), id)
		if err != nil || run == nil {
			return
		}
		ch <- sse.Message{Event: "run-start", Data: map[string]any{"runId": id, "argv": run.Argv}}
		for _, line := range strings.Split(run.Events, "\n") {
			if line = strings.TrimSpace(line); line == "" {
				continue
			}
			var obj map[string]any
			if json.Unmarshal([]byte(line), &obj) != nil {
				continue
			}
			ev, _ := obj["e"].(string)
			ch <- sse.Message{Event: "ansible-" + strings.ReplaceAll(ev, "_", "-"), Data: obj}
		}
		ch <- sse.Message{Event: "run-end", Data: map[string]any{"runId": id, "status": run.Status}}

	case "runbook":
		if h.Runbook == nil {
			return
		}
		run, err := h.Runbook.GetRun(owner(r), id)
		if err != nil || run == nil {
			return
		}
		ch <- sse.Message{Event: "run-start", Data: map[string]any{"runId": id, "steps": len(run.Steps)}}
		for _, st := range run.Steps {
			ch <- sse.Message{Event: "step-end", Data: st}
		}
		ch <- sse.Message{Event: "run-end", Data: map[string]any{"runId": id, "status": run.Status}}
	}
}

// Cancel: POST /runs/{id}/cancel?module=
func (h *RunsHandlers) Cancel(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		apierr.Write(w, apierr.Unavailable("background runs"))
		return
	}
	module := r.URL.Query().Get("module")
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if !h.authorize(r, module, id) {
		apierr.Write(w, apierr.NotFound("run not found"))
		return
	}
	if !h.Hub.Cancel(runstream.Key{Module: module, ID: id}) {
		apierr.Write(w, apierr.Validation("that run is not active"))
		return
	}
	audit(r, "run_cancel", module+"/"+strconv.FormatInt(id, 10), nil)
	WriteJSON(w, http.StatusOK, map[string]string{"status": "cancelling"})
}
