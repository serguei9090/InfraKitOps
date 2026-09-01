package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/llm"
	"github.com/infrakit/backend/internal/mcp"
	"github.com/infrakit/backend/internal/sse"
)

// LLMHandlers wires /llm*. Nil Store/Engine → every endpoint 503.
type LLMHandlers struct {
	Store  *llm.Store
	Engine *llm.Engine
	// MCP resolves the `tools` stream param into tool definitions. Nil → tools off.
	MCP *mcp.Manager
	// History persists saved conversations (A3b). Nil → /llm/conversations* 503.
	History *llm.History
	// Usage aggregates token counts (A3c). Nil → /llm/usage 503.
	Usage *llm.UsageStore
}

// resolveTools turns a `tools` query value ("all" or a comma list of server
// ids) into tool definitions for the model. Empty / no MCP → nil.
func (h *LLMHandlers) resolveTools(ctx context.Context, spec string) []llm.ToolDef {
	if spec == "" || h.MCP == nil {
		return nil
	}
	tctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	all, err := h.MCP.AggregateTools(tctx)
	if err != nil || len(all) == 0 {
		return nil
	}
	var want map[string]bool
	if spec != "all" {
		want = map[string]bool{}
		for _, id := range strings.Split(spec, ",") {
			want[strings.TrimSpace(id)] = true
		}
	}
	out := make([]llm.ToolDef, 0, len(all))
	for _, s := range all {
		if want != nil && !want[s.Server] {
			continue
		}
		out = append(out, llm.ToolDef{
			Name: s.QualifiedName, Description: s.Description,
			Parameters: s.InputSchema, ReadOnly: s.ReadOnly,
		})
	}
	return out
}

func (h *LLMHandlers) ok() bool { return h != nil && h.Store != nil && h.Engine != nil }

func (h *LLMHandlers) guard(w http.ResponseWriter) bool {
	if !h.ok() {
		apierr.Write(w, apierr.Unavailable("the AI layer"))
		return false
	}
	return true
}

func llmErr(w http.ResponseWriter, err error) {
	var ae *apierr.Error
	switch {
	case errors.As(err, &ae):
		apierr.Write(w, ae)
	case errors.Is(err, llm.ErrNotFound):
		apierr.Write(w, apierr.NotFound("not found"))
	default:
		apierr.Write(w, apierr.Validation(err.Error()))
	}
}

// ListConnections: GET /llm/connections
func (h *LLMHandlers) ListConnections(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	list, err := h.Store.ListConnections(owner(r))
	if err != nil {
		llmErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"connections": list})
}

// PutConnection: POST /llm/connections  or  PUT /llm/connections/{id}
func (h *LLMHandlers) PutConnection(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var c llm.Connection
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		c.ID = id
	}
	saved, err := h.Store.PutConnection(owner(r), c)
	if err != nil {
		llmErr(w, err)
		return
	}
	h.Engine.InvalidateCache(saved.ID)
	audit(r, "llm_connection_write", saved.Name, map[string]any{"provider": saved.Provider})
	WriteJSON(w, http.StatusOK, map[string]any{"connection": saved})
}

// DeleteConnection: DELETE /llm/connections/{id}
func (h *LLMHandlers) DeleteConnection(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	id := chi.URLParam(r, "id")
	if err := h.Store.DeleteConnection(owner(r), id); err != nil {
		llmErr(w, err)
		return
	}
	h.Engine.InvalidateCache(id)
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// TestConnection: POST /llm/connections/{id}/test
func (h *LLMHandlers) TestConnection(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	models, err := h.Engine.TestConnection(ctx, chi.URLParam(r, "id"))
	if err != nil {
		out := map[string]any{"ok": false, "error": err.Error()}
		var ae *apierr.Error
		if errors.As(err, &ae) {
			out["code"] = string(ae.Code)
			out["hint"] = ae.Hint
		}
		WriteJSON(w, http.StatusOK, out)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "models": models})
}

// Models: GET /llm/connections/{id}/models?force=1
func (h *LLMHandlers) Models(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	force := r.URL.Query().Get("force") == "1"
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	models, err := h.Engine.Models(ctx, chi.URLParam(r, "id"), force)
	if err != nil {
		llmErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"models": models})
}

// --- settings ----------------------------------------------------

// GetSettings: GET /llm/settings
func (h *LLMHandlers) GetSettings(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"settings": h.Store.GetSettings()})
}

// PutSettings: PUT /llm/settings — merge-write, returns the merged map.
// Instance-wide (default connection/model/temp) → admin only in multi-user.
func (h *LLMHandlers) PutSettings(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) || !requireAdmin(w, r) {
		return
	}
	var patch map[string]string
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	for k, v := range patch {
		_ = h.Store.PutSetting(k, v)
	}
	WriteJSON(w, http.StatusOK, map[string]any{"settings": h.Store.GetSettings()})
}

// --- tasks --------------------------------------------------------

// ListTasks: GET /llm/tasks
func (h *LLMHandlers) ListTasks(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	tasks, err := h.Store.ListTasks(owner(r))
	if err != nil {
		llmErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"tasks": tasks})
}

// PutTask: POST /llm/tasks  or  PUT /llm/tasks/{id}
func (h *LLMHandlers) PutTask(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var t llm.Task
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		t.ID = id
	}
	saved, err := h.Store.PutTask(owner(r), t)
	if err != nil {
		llmErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"task": saved})
}

// DeleteTask: DELETE /llm/tasks/{id}
func (h *LLMHandlers) DeleteTask(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Store.DeleteTask(owner(r), chi.URLParam(r, "id")); err != nil {
		llmErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// TaskRunStream: GET /llm/tasks/{id}/run/stream?connId=&model=&context=<json>&input=&history=<json>
func (h *LLMHandlers) TaskRunStream(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		sse.Reject(w, "llm layer unavailable")
		return
	}
	q := r.URL.Query()
	connID := q.Get("connId")
	if connID == "" {
		sse.Reject(w, "connId is required")
		return
	}
	vars := map[string]string{}
	if raw := q.Get("context"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &vars); err != nil {
			sse.Reject(w, "bad context json")
			return
		}
	}
	var history []llm.ChatMessage
	if raw := q.Get("history"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &history); err != nil {
			sse.Reject(w, "bad history json")
			return
		}
	}

	sw, err := sse.New(w)
	if err != nil {
		return
	}
	ch := make(chan sse.Message, 128)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	// The task's own `tools` config is the source; an explicit ?tools= query
	// (playground-style) overrides it.
	toolSpec := q.Get("tools")
	if toolSpec == "" {
		if t, err := h.Store.GetTask(owner(r), chi.URLParam(r, "id")); err == nil && len(t.Tools) > 0 {
			toolSpec = strings.Join(t.Tools, ",")
		}
	}
	tools := h.resolveTools(r.Context(), toolSpec)
	go func() {
		h.Engine.RunTask(ctx, chi.URLParam(r, "id"), connID, q.Get("model"), vars, q.Get("input"), history, tools, ch)
		close(ch)
	}()
	sw.Pump(ctx, ch)
}

// ChatStream: GET /llm/chat/stream?connId=&model=&messages=<url-encoded json>&temperature=
func (h *LLMHandlers) ChatStream(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		sse.Reject(w, "llm layer unavailable")
		return
	}
	q := r.URL.Query()
	connID := q.Get("connId")
	if connID == "" {
		sse.Reject(w, "connId is required")
		return
	}
	var msgs []llm.ChatMessage
	if raw := q.Get("messages"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &msgs); err != nil {
			sse.Reject(w, "bad messages json")
			return
		}
	}
	if len(msgs) == 0 {
		sse.Reject(w, "messages is required")
		return
	}
	req := llm.ChatRequest{Model: q.Get("model"), Messages: msgs}
	if t := q.Get("temperature"); t != "" {
		if f, err := strconv.ParseFloat(t, 64); err == nil {
			req.Temperature = &f
		}
	}
	if mt := q.Get("maxTokens"); mt != "" {
		if n, err := strconv.Atoi(mt); err == nil {
			req.MaxTokens = n
		}
	}
	req.Tools = h.resolveTools(r.Context(), q.Get("tools"))

	sw, err := sse.New(w)
	if err != nil {
		return
	}
	ch := make(chan sse.Message, 128)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		h.Engine.Chat(ctx, connID, req, ch)
		close(ch)
	}()
	sw.Pump(ctx, ch)
}

// ResumeTool: POST /llm/tool/{id}/resume  {approved:bool} — deliver the user's
// decision for a paused (non-read-only) tool call (A4c).
func (h *LLMHandlers) ResumeTool(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var b struct {
		Approved bool `json:"approved"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	ok := h.Engine.ResumeTool(chi.URLParam(r, "id"), b.Approved)
	WriteJSON(w, http.StatusOK, map[string]bool{"ok": ok})
}

// --- conversation history (A3b) ----------------------------------

func (h *LLMHandlers) historyGuard(w http.ResponseWriter) bool {
	if h == nil || h.History == nil {
		apierr.Write(w, apierr.Unavailable("conversation history"))
		return false
	}
	return true
}

// SaveConversation: POST /llm/conversations  (id in the body → replace).
func (h *LLMHandlers) SaveConversation(w http.ResponseWriter, r *http.Request) {
	if !h.historyGuard(w) {
		return
	}
	var b struct {
		llm.Conversation
		Messages []llm.StoredMessage `json:"messages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	id, err := h.History.Save(owner(r), b.Conversation, b.Messages)
	if err != nil {
		llmErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"id": id})
}

// ListConversations: GET /llm/conversations
func (h *LLMHandlers) ListConversations(w http.ResponseWriter, r *http.Request) {
	if !h.historyGuard(w) {
		return
	}
	list, err := h.History.List(owner(r))
	if err != nil {
		llmErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"conversations": list})
}

// GetConversation: GET /llm/conversations/{id}
func (h *LLMHandlers) GetConversation(w http.ResponseWriter, r *http.Request) {
	if !h.historyGuard(w) {
		return
	}
	conv, msgs, err := h.History.Get(owner(r), chi.URLParam(r, "id"))
	if err != nil {
		llmErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"conversation": conv, "messages": msgs})
}

// PatchConversation: PATCH /llm/conversations/{id}  {title?, pinned?}
func (h *LLMHandlers) PatchConversation(w http.ResponseWriter, r *http.Request) {
	if !h.historyGuard(w) {
		return
	}
	var b struct {
		Title  *string `json:"title"`
		Pinned *bool   `json:"pinned"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if err := h.History.Patch(owner(r), chi.URLParam(r, "id"), b.Title, b.Pinned); err != nil {
		llmErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// DeleteConversation: DELETE /llm/conversations/{id}
func (h *LLMHandlers) DeleteConversation(w http.ResponseWriter, r *http.Request) {
	if !h.historyGuard(w) {
		return
	}
	if err := h.History.Delete(owner(r), chi.URLParam(r, "id")); err != nil {
		llmErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Usage: GET /llm/usage?days=7&groupBy=model|day|task  (A3c). Token counts
// only — no cost.
func (h *LLMHandlers) UsageReport(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.Usage == nil {
		apierr.Write(w, apierr.Unavailable("usage accounting"))
		return
	}
	days := 7
	if d := r.URL.Query().Get("days"); d != "" {
		if n, err := strconv.Atoi(d); err == nil && n > 0 && n <= 366 {
			days = n
		}
	}
	since := time.Now().Add(-time.Duration(days) * 24 * time.Hour).UnixMilli()
	groups, err := h.Usage.Aggregate(owner(r), since, r.URL.Query().Get("groupBy"))
	if err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"days": days, "groups": groups})
}

// LLMProviders reports the provider kinds this build supports.
func LLMProviders() []string {
	out := make([]string, 0)
	for _, k := range llm.Providers() {
		out = append(out, string(k))
	}
	return out
}
