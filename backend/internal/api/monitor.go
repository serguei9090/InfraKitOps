package api

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/monitor"
	"github.com/infrakit/backend/internal/sse"
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

// List: GET /monitors?tag=
func (h *MonitorHandlers) List(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	ms, err := h.Store.List(owner(r), r.URL.Query().Get("tag"))
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
	if !monitor.KnownKind(m.Kind) {
		apierr.Write(w, apierr.Validation("unknown monitor kind: "+m.Kind))
		return
	}
	// an ssh monitor can carry its target in config.nodeId instead
	targetOptional := m.Kind == monitor.KindSSH && m.Config["nodeId"] != nil && m.Config["nodeId"] != ""
	if m.Name == "" || (m.Target == "" && !targetOptional) {
		apierr.Write(w, apierr.Validation("name and target are required"))
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

// Incidents: GET /monitors/{id}/incidents?since=&limit=
func (h *MonitorHandlers) Incidents(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	if since == 0 {
		since = time.Now().Add(-30 * 24 * time.Hour).UnixMilli()
	}
	inc, err := h.Store.Incidents(owner(r), chi.URLParam(r, "id"), since, atoiOr(r.URL.Query().Get("limit"), 0))
	if err != nil {
		monitorErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"incidents": inc})
}

// Series: GET /monitors/{id}/series?from=&to=&period=auto|raw|1m|1h
func (h *MonitorHandlers) Series(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	from, _ := strconv.ParseInt(r.URL.Query().Get("from"), 10, 64)
	to, _ := strconv.ParseInt(r.URL.Query().Get("to"), 10, 64)
	period, points, err := h.Store.Series(owner(r), chi.URLParam(r, "id"), from, to, r.URL.Query().Get("period"))
	if err != nil {
		monitorErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"period": period, "points": points})
}

// Summary: GET /monitors/summary — per-monitor + per-tag uptime windows.
func (h *MonitorHandlers) Summary(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	perMon, perTag, err := h.Store.Summary(owner(r), time.Now())
	if err != nil {
		monitorErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"monitors": perMon, "tags": perTag})
}

// Report: GET /monitors/{id}/report?format=json|csv
func (h *MonitorHandlers) Report(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	rep, err := h.Store.Report(owner(r), chi.URLParam(r, "id"), time.Now())
	if err != nil {
		monitorErr(w, err)
		return
	}
	if r.URL.Query().Get("format") == "csv" {
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s-report.csv"`, rep.Monitor.ID))
		cw := csv.NewWriter(w)
		_ = cw.Write([]string{"incident_id", "started_at", "ended_at", "duration_ms", "ongoing", "detail"})
		now := rep.GeneratedAt
		for _, in := range rep.Incidents {
			ongoing := "false"
			if in.EndedAt == 0 {
				ongoing = "true"
			}
			_ = cw.Write([]string{
				strconv.FormatInt(in.ID, 10),
				time.UnixMilli(in.StartedAt).UTC().Format(time.RFC3339),
				endedCSV(in.EndedAt),
				strconv.FormatInt(in.Duration(now), 10),
				ongoing,
				in.Detail,
			})
		}
		cw.Flush()
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"report": rep})
}

func endedCSV(ms int64) string {
	if ms == 0 {
		return ""
	}
	return time.UnixMilli(ms).UTC().Format(time.RFC3339)
}

// Bulk: POST /monitors/bulk  {text}
func (h *MonitorHandlers) Bulk(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	drafts, errs := monitor.ParseBulk(body.Text)
	created := make([]monitor.Monitor, 0, len(drafts))
	for i, d := range drafts {
		saved, err := h.Store.Put(owner(r), d)
		if err != nil {
			errs = append(errs, monitor.BulkError{Line: i + 1, Text: d.Name, Err: err.Error()})
			continue
		}
		h.Engine.Reload(*saved)
		created = append(created, *saved)
	}
	audit(r, "monitor_bulk", "", map[string]string{"created": strconv.Itoa(len(created))})
	WriteJSON(w, http.StatusOK, map[string]any{"created": created, "errors": errs})
}

// Template: POST /monitors/template  {template, hostname, tags}
func (h *MonitorHandlers) Template(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body struct {
		Template string `json:"template"`
		Hostname string `json:"hostname"`
		Tags     string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	drafts, err := monitor.BuildTemplate(body.Template, body.Hostname, body.Tags)
	if err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	created := make([]monitor.Monitor, 0, len(drafts))
	for _, d := range drafts {
		saved, err := h.Store.Put(owner(r), d)
		if err != nil {
			monitorErr(w, err)
			return
		}
		h.Engine.Reload(*saved)
		created = append(created, *saved)
	}
	audit(r, "monitor_template", body.Template, map[string]string{"hostname": body.Hostname})
	WriteJSON(w, http.StatusOK, map[string]any{"created": created})
}

// --- M5: public status boards -----------------------------------

// StatusBoards: GET /monitors/status-boards
func (h *MonitorHandlers) StatusBoards(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	bs, err := h.Store.ListBoards(owner(r))
	if err != nil {
		monitorErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"boards": bs})
}

// SaveBoard: POST /monitors/status-boards | PUT /monitors/status-boards/{id}
func (h *MonitorHandlers) SaveBoard(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var b monitor.StatusBoard
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		b.ID = id
	}
	saved, err := h.Store.PutBoard(owner(r), b)
	if err != nil {
		monitorErr(w, err)
		return
	}
	audit(r, "monitor_status_board", saved.Title, nil)
	WriteJSON(w, http.StatusOK, map[string]any{"board": saved})
}

// RotateBoard: POST /monitors/status-boards/{id}/rotate
func (h *MonitorHandlers) RotateBoard(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	b, err := h.Store.RotateBoardToken(owner(r), chi.URLParam(r, "id"))
	if err != nil {
		monitorErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"board": b})
}

// DeleteBoard: DELETE /monitors/status-boards/{id}
func (h *MonitorHandlers) DeleteBoard(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Store.DeleteBoard(owner(r), chi.URLParam(r, "id")); err != nil {
		monitorErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// PublicStatus: GET /status/{token} — NO auth, stripped read-only payload.
func (h *MonitorHandlers) PublicStatus(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		apierr.Write(w, apierr.Unavailable("the Monitors module"))
		return
	}
	ps, err := h.Store.PublicStatus(chi.URLParam(r, "token"), time.Now())
	if err != nil {
		apierr.Write(w, apierr.NotFound("status page not found"))
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=30")
	WriteJSON(w, http.StatusOK, ps)
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

// Mute: POST /monitors/{id}/mute {untilMs}  ·  Unmute: POST /monitors/{id}/unmute
func (h *MonitorHandlers) Mute(mute bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !h.guard(w) {
			return
		}
		var until int64
		if mute {
			var body struct {
				UntilMs int64 `json:"untilMs"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			until = body.UntilMs
			if until == 0 {
				until = time.Now().Add(time.Hour).UnixMilli() // default: 1h snooze
			}
		}
		m, err := h.Store.SetMute(owner(r), chi.URLParam(r, "id"), until)
		if err != nil {
			monitorErr(w, err)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"monitor": m})
	}
}

// CheckAll: POST /monitors/check-all — probe every enabled monitor now.
func (h *MonitorHandlers) CheckAll(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	list, err := h.Store.List(owner(r), "")
	if err != nil {
		monitorErr(w, err)
		return
	}
	n := 0
	for _, m := range list {
		if !m.Enabled {
			continue
		}
		n++
		mm := m
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			h.Engine.CheckNow(ctx, mm)
		}()
	}
	WriteJSON(w, http.StatusOK, map[string]any{"checking": n})
}

// Stream: GET /monitors/stream — SSE of status-change events for the caller.
func (h *MonitorHandlers) Stream(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		sse.RejectCoded(w, string(apierr.CodeInternal), "the Monitors module is not available", "")
		return
	}
	sw, err := sse.New(w)
	if err != nil {
		return
	}
	me := owner(r)
	events, unsub := h.Engine.Subscribe()
	defer unsub()

	msgs := make(chan sse.Message, 16)
	go func() {
		defer close(msgs)
		for ev := range events {
			if ev.Monitor.Owner != "" && ev.Monitor.Owner != me {
				continue
			}
			msgs <- sse.Message{Event: "monitor-alert", Data: map[string]any{
				"id": ev.Monitor.ID, "name": ev.Monitor.Name, "kind": ev.Monitor.Kind,
				"target": ev.Monitor.Target, "event": ev.Event, "detail": ev.Detail, "at": ev.At,
			}}
		}
	}()
	sw.Pump(r.Context(), msgs)
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
