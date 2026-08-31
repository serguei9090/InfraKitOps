package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/executor"
	"github.com/infrakit/backend/internal/orchestrator"
	"github.com/infrakit/backend/internal/sse"
)

// RunbookHandlers wires the /runbook* endpoints. Nil Store → every endpoint 503.
type RunbookHandlers struct {
	Store  *orchestrator.Store
	Engine *orchestrator.Engine
}

func (h *RunbookHandlers) ok() bool { return h != nil && h.Store != nil && h.Engine != nil }

func (h *RunbookHandlers) guard(w http.ResponseWriter) bool {
	if !h.ok() {
		WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "runbooks store unavailable"})
		return false
	}
	return true
}

func writeStoreErr(w http.ResponseWriter, err error) {
	if errors.Is(err, orchestrator.ErrNotFound) {
		WriteJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
}

// ListRunbooks: GET /runbooks
func (h *RunbookHandlers) List(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	list, err := h.Store.ListRunbooks()
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"runbooks": list})
}

// Create: POST /runbooks   { spec }
func (h *RunbookHandlers) Create(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body struct {
		Spec orchestrator.Spec `json:"spec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if body.Spec.Name == "" {
		body.Spec.Name = "Untitled runbook"
	}
	rb, err := h.Store.CreateRunbook(body.Spec)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"runbook": rb})
}

// Get: GET /runbooks/{id}
func (h *RunbookHandlers) Get(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	rb, err := h.Store.GetRunbook(chi.URLParam(r, "id"))
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"runbook": rb})
}

// SaveDraft: PUT /runbooks/{id}/draft   { spec }
func (h *RunbookHandlers) SaveDraft(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body struct {
		Spec orchestrator.Spec `json:"spec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := h.Store.SaveDraft(chi.URLParam(r, "id"), body.Spec); err != nil {
		writeStoreErr(w, err)
		return
	}
	h.Get(w, r)
}

// DiscardDraft: DELETE /runbooks/{id}/draft
func (h *RunbookHandlers) DiscardDraft(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Store.DiscardDraft(chi.URLParam(r, "id")); err != nil {
		writeStoreErr(w, err)
		return
	}
	h.Get(w, r)
}

// SaveVersion: POST /runbooks/{id}/versions   { note }
func (h *RunbookHandlers) SaveVersion(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body struct {
		Note string `json:"note"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	rb, err := h.Store.SaveVersion(chi.URLParam(r, "id"), body.Note)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"runbook": rb})
}

// VersionAction: POST /runbooks/{id}/versions/{n}/{action}  (restore | pin | unpin)
// DeleteVersion: DELETE /runbooks/{id}/versions/{n}
func (h *RunbookHandlers) VersionAction(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	id := chi.URLParam(r, "id")
	n, _ := strconv.Atoi(chi.URLParam(r, "n"))
	var err error
	switch chi.URLParam(r, "action") {
	case "restore":
		err = h.Store.RestoreVersion(id, n)
	case "pin":
		err = h.Store.PinVersion(id, n, true)
	case "unpin":
		err = h.Store.PinVersion(id, n, false)
	default:
		err = errors.New("unknown action")
	}
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	h.Get(w, r)
}

func (h *RunbookHandlers) DeleteVersion(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	n, _ := strconv.Atoi(chi.URLParam(r, "n"))
	if err := h.Store.DeleteVersion(chi.URLParam(r, "id"), n); err != nil {
		writeStoreErr(w, err)
		return
	}
	h.Get(w, r)
}

// Publish: POST /runbooks/{id}/publish  { published }
func (h *RunbookHandlers) Publish(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body struct {
		Published bool `json:"published"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := h.Store.SetPublished(chi.URLParam(r, "id"), body.Published); err != nil {
		writeStoreErr(w, err)
		return
	}
	h.Get(w, r)
}

// Delete: DELETE /runbooks/{id}
func (h *RunbookHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Store.DeleteRunbook(chi.URLParam(r, "id")); err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Preview: POST /runbooks/{id}/preview   { version?, args }
func (h *RunbookHandlers) Preview(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	rb, err := h.Store.GetRunbook(chi.URLParam(r, "id"))
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	var body struct {
		Version int               `json:"version"`
		Args    map[string]string `json:"args"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	p, _, _, err := h.Engine.BuildPreview(rb, body.Version, body.Args)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, p)
}

// RunStream: GET /runbooks/{id}/run/stream?version=&dryRun=&args=<url-encoded json>
func (h *RunbookHandlers) RunStream(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		sse.Reject(w, "runbooks store unavailable")
		return
	}
	rb, err := h.Store.GetRunbook(chi.URLParam(r, "id"))
	if err != nil {
		sse.Reject(w, "runbook not found")
		return
	}
	q := r.URL.Query()
	version, _ := strconv.Atoi(q.Get("version"))
	dryRun := q.Get("dryRun") == "1" || q.Get("dryRun") == "true"

	var args map[string]string
	if raw := q.Get("args"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &args); err != nil {
			sse.Reject(w, "bad args json")
			return
		}
	}

	// Published gate: a non-author (no ?author=1) may only run a published runbook.
	if !rb.Published && q.Get("author") != "1" && !dryRun {
		sse.Reject(w, "this runbook is a draft — publish it before running")
		return
	}

	sw, err := sse.New(w)
	if err != nil {
		return
	}
	ch := make(chan sse.Message, 128)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		h.Engine.Run(ctx, rb, version, args, dryRun, ch)
		close(ch)
	}()
	sw.Pump(ctx, ch)
}

// ListRuns: GET /runs?runbookId=&limit=
func (h *RunbookHandlers) ListRuns(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	runs, err := h.Store.ListRuns(r.URL.Query().Get("runbookId"), limit)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

// GetRun: GET /runs/{id}
func (h *RunbookHandlers) GetRun(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	run, err := h.Store.GetRun(id)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"run": run})
}

// --- ssh nodes ---------------------------------------------------------

func (h *RunbookHandlers) ListNodes(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	nodes, err := h.Store.ListNodes()
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"nodes": nodes})
}

func (h *RunbookHandlers) PutNode(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var n orchestrator.SSHNode
	if err := json.NewDecoder(r.Body).Decode(&n); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		n.ID = id
	}
	saved, err := h.Store.PutNode(n)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"node": saved})
}

func (h *RunbookHandlers) DeleteNode(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Store.DeleteNode(chi.URLParam(r, "id")); err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// --- settings --------------------------------------------------------

func (h *RunbookHandlers) GetSettings(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"settings": h.Store.GetSettings()})
}

func (h *RunbookHandlers) PutSettings(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body map[string]string
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	for k, v := range body {
		_ = h.Store.PutSetting(k, v)
	}
	WriteJSON(w, http.StatusOK, map[string]any{"settings": h.Store.GetSettings()})
}

// RunbookExecutors reports which executor kinds this host can run.
func RunbookExecutors() map[string]bool {
	out := map[string]bool{}
	for k, v := range executor.AvailableKinds() {
		out[string(k)] = v
	}
	return out
}
