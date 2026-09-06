package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/monitor"
)

// MonitorHandlers wires /monitors* (MONITORS_MODULE_PLAN.md). Nil Store/Engine
// → every endpoint 503.
type MonitorHandlers struct {
	Store  *monitor.Store
	Engine *monitor.Engine
}

func (h *MonitorHandlers) ok() bool { return h != nil && h.Store != nil && h.Engine != nil }

func (h *MonitorHandlers) guard(w http.ResponseWriter) bool {
	if !h.ok() {
		apierr.Write(w, apierr.Unavailable("the Monitors module"))
		return false
	}
	return true
}

func monitorErr(w http.ResponseWriter, err error) {
	if errors.Is(err, monitor.ErrNotFound) {
		apierr.Write(w, apierr.NotFound("monitor not found"))
		return
	}
	apierr.Write(w, apierr.Validation(err.Error()))
}

// List: GET /monitors
func (h *MonitorHandlers) List(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	ms, err := h.Store.List(owner(r))
	if err != nil {
		monitorErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"monitors": ms})
}

// Get: GET /monitors/{id}
func (h *MonitorHandlers) Get(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	m, err := h.Store.Get(owner(r), chi.URLParam(r, "id"))
	if err != nil {
		monitorErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"monitor": m})
}

// Save: POST /monitors  (create) or PUT /monitors/{id}  (update)
func (h *MonitorHandlers) Save(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	raw, _ := io.ReadAll(r.Body)
	var m monitor.Monitor
	if err := json.Unmarshal(raw, &m); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		m.ID = id
	}
	if m.Name == "" || m.Kind == "" || m.Target == "" {
		apierr.Write(w, apierr.Validation("name, kind and target are required"))
		return
	}
	// A new monitor is enabled unless the caller explicitly said otherwise —
	// you create one to run it.
	if m.ID == "" && !bytes.Contains(raw, []byte(`"enabled"`)) {
		m.Enabled = true
	}
	saved, err := h.Store.Put(owner(r), m)
	if err != nil {
		monitorErr(w, err)
		return
	}
	audit(r, "monitor_save", saved.Name, map[string]string{"kind": saved.Kind, "target": saved.Target})
	h.Engine.Reload(*saved)
	WriteJSON(w, http.StatusOK, map[string]any{"monitor": saved})
}

// Delete: DELETE /monitors/{id}
func (h *MonitorHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	id := chi.URLParam(r, "id")
	if err := h.Store.Delete(owner(r), id); err != nil {
		monitorErr(w, err)
		return
	}
	h.Engine.Stop(id)
	audit(r, "monitor_delete", id, nil)
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Samples: GET /monitors/{id}/samples?since=&limit=
func (h *MonitorHandlers) Samples(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	limit := atoiOr(r.URL.Query().Get("limit"), 0)
	smp, err := h.Store.Samples(owner(r), chi.URLParam(r, "id"), since, limit)
	if err != nil {
		monitorErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"samples": smp})
}

// SetPaused: POST /monitors/{id}/pause | /resume
func (h *MonitorHandlers) SetPaused(paused bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !h.guard(w) {
			return
		}
		m, err := h.Store.SetEnabled(owner(r), chi.URLParam(r, "id"), !paused)
		if err != nil {
			monitorErr(w, err)
			return
		}
		if paused {
			h.Engine.Stop(m.ID)
		} else {
			h.Engine.Reload(*m)
		}
		WriteJSON(w, http.StatusOK, map[string]any{"monitor": m})
	}
}

// CheckNow: POST /monitors/{id}/check — run one probe immediately.
func (h *MonitorHandlers) CheckNow(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	m, err := h.Store.Get(owner(r), chi.URLParam(r, "id"))
	if err != nil {
		monitorErr(w, err)
		return
	}
	s := h.Engine.CheckNow(r.Context(), *m)
	fresh, _ := h.Store.Get(owner(r), m.ID)
	WriteJSON(w, http.StatusOK, map[string]any{"sample": s, "monitor": fresh})
}
