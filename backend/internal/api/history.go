package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/history"
)

// HistoryHandlers serves the run-history endpoints. A nil Store makes every
// endpoint return 503 (the tools still work, they just can't persist runs).
type HistoryHandlers struct {
	Store         *history.Store
	AppVersion    string
	DefaultPolicy history.PrunePolicy
}

func (h *HistoryHandlers) unavailable(w http.ResponseWriter) bool {
	if h.Store == nil {
		WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "history storage is not available"})
		return true
	}
	return false
}

// Save: POST /history  — body is a RunEnvelope. Optional ?retentionDays= &maxPerTarget=
// override the module defaults for this run's prune pass.
func (h *HistoryHandlers) Save(w http.ResponseWriter, r *http.Request) {
	if h.unavailable(w) {
		return
	}
	var env envelope.Envelope
	if err := json.NewDecoder(r.Body).Decode(&env); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid envelope: " + err.Error()})
		return
	}
	policy := h.DefaultPolicy
	if v := intParam(r, "retentionDays", -1); v >= 0 {
		policy.RetentionDays = v
	}
	if v := intParam(r, "maxPerTarget", -1); v >= 0 {
		policy.MaxPerTarget = v
	}
	id, err := h.Store.Save(env, h.AppVersion, policy)
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	WriteJSON(w, http.StatusOK, map[string]int64{"id": id})
}

// List: GET /history?tool=&target=&limit=
func (h *HistoryHandlers) List(w http.ResponseWriter, r *http.Request) {
	if h.unavailable(w) {
		return
	}
	runs, err := h.Store.List(r.URL.Query().Get("tool"), r.URL.Query().Get("target"), intParam(r, "limit", 0))
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

// Get: GET /history/{id}
func (h *HistoryHandlers) Get(w http.ResponseWriter, r *http.Request) {
	if h.unavailable(w) {
		return
	}
	id, ok := idParam(w, r)
	if !ok {
		return
	}
	run, err := h.Store.Get(id)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if run == nil {
		WriteJSON(w, http.StatusNotFound, map[string]string{"error": "no such run"})
		return
	}
	WriteJSON(w, http.StatusOK, run)
}

// Patch: PATCH /history/{id}  — body { pinned?: bool, label?: string }
func (h *HistoryHandlers) Patch(w http.ResponseWriter, r *http.Request) {
	if h.unavailable(w) {
		return
	}
	id, ok := idParam(w, r)
	if !ok {
		return
	}
	var body struct {
		Pinned *bool   `json:"pinned"`
		Label  *string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if body.Pinned != nil {
		if err := h.Store.SetPinned(id, *body.Pinned); err != nil {
			WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
	}
	if body.Label != nil {
		if err := h.Store.SetLabel(id, *body.Label); err != nil {
			WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
	}
	WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Delete: DELETE /history/{id}
func (h *HistoryHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	if h.unavailable(w) {
		return
	}
	id, ok := idParam(w, r)
	if !ok {
		return
	}
	if err := h.Store.Delete(id); err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func intParam(r *http.Request, name string, def int) int {
	v := r.URL.Query().Get(name)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func idParam(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return 0, false
	}
	return id, true
}
