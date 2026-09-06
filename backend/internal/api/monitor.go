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
	Store    *monitor.Store
	Engine   *monitor.Engine
	Notifier *monitor.Notifier // M3 — nil → /settings/test 503
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
	if !monitor.KnownKind(m.Kind) {
		apierr.Write(w, apierr.Validation("unknown monitor kind: "+m.Kind))
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

// GetSettings: GET /monitors/settings
func (h *MonitorHandlers) GetSettings(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	set, err := h.Store.GetSettings(owner(r))
	if err != nil {
		monitorErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"settings": redactSettings(set)})
}

// PutSettings: PUT /monitors/settings
func (h *MonitorHandlers) PutSettings(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	in := monitor.DefaultSettings()
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	// A blank / still-redacted secret means "keep what's stored".
	prev, _ := h.Store.GetSettings(owner(r))
	if in.Webhook.Secret == "" || in.Webhook.Secret == "••••" {
		in.Webhook.Secret = prev.Webhook.Secret
	}
	if in.SMTP.Password == "" || in.SMTP.Password == "••••" {
		in.SMTP.Password = prev.SMTP.Password
	}
	if err := h.Store.PutSettings(owner(r), in); err != nil {
		monitorErr(w, err)
		return
	}
	audit(r, "monitor_settings", in.DefaultChannel, nil)
	WriteJSON(w, http.StatusOK, map[string]any{"settings": redactSettings(in)})
}

// TestChannel: POST /monitors/settings/test  {channel?}
func (h *MonitorHandlers) TestChannel(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) || h.Notifier == nil {
		apierr.Write(w, apierr.Unavailable("alert delivery"))
		return
	}
	var body struct {
		Channel string `json:"channel"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	m := monitor.Monitor{
		Owner: owner(r), Name: "test monitor", Kind: "test", Target: "-", Channel: body.Channel,
	}
	if err := h.Notifier.Send(r.Context(), m, "test", "this is a test alert from InfraKit"); err != nil {
		apierr.Write(w, apierr.Upstream("test alert failed: "+err.Error()))
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

// redactSettings blanks secret refs before sending settings to the client.
func redactSettings(s monitor.Settings) monitor.Settings {
	if s.Webhook.Secret != "" {
		s.Webhook.Secret = "••••"
	}
	if s.SMTP.Password != "" {
		s.SMTP.Password = "••••"
	}
	return s
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
