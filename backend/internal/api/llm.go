package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/llm"
	"github.com/infrakit/backend/internal/sse"
)

// LLMHandlers wires /llm*. Nil Store/Engine → every endpoint 503.
type LLMHandlers struct {
	Store  *llm.Store
	Engine *llm.Engine
}

func (h *LLMHandlers) ok() bool { return h != nil && h.Store != nil && h.Engine != nil }

func (h *LLMHandlers) guard(w http.ResponseWriter) bool {
	if !h.ok() {
		WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "llm layer unavailable"})
		return false
	}
	return true
}

func llmErr(w http.ResponseWriter, err error) {
	if errors.Is(err, llm.ErrNotFound) {
		WriteJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
}

// ListConnections: GET /llm/connections
func (h *LLMHandlers) ListConnections(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	list, err := h.Store.ListConnections()
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
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		c.ID = id
	}
	saved, err := h.Store.PutConnection(c)
	if err != nil {
		llmErr(w, err)
		return
	}
	h.Engine.InvalidateCache(saved.ID)
	WriteJSON(w, http.StatusOK, map[string]any{"connection": saved})
}

// DeleteConnection: DELETE /llm/connections/{id}
func (h *LLMHandlers) DeleteConnection(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	id := chi.URLParam(r, "id")
	if err := h.Store.DeleteConnection(id); err != nil {
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
		WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
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
func (h *LLMHandlers) PutSettings(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var patch map[string]string
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	for k, v := range patch {
		_ = h.Store.PutSetting(k, v)
	}
	WriteJSON(w, http.StatusOK, map[string]any{"settings": h.Store.GetSettings()})
}

// --- tasks --------------------------------------------------------

// ListTasks: GET /llm/tasks
func (h *LLMHandlers) ListTasks(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	tasks, err := h.Store.ListTasks()
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
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		t.ID = id
	}
	saved, err := h.Store.PutTask(t)
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
	if err := h.Store.DeleteTask(chi.URLParam(r, "id")); err != nil {
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
	go func() {
		h.Engine.RunTask(ctx, chi.URLParam(r, "id"), connID, q.Get("model"), vars, q.Get("input"), history, ch)
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

// LLMProviders reports the provider kinds this build supports.
func LLMProviders() []string {
	out := make([]string, 0)
	for _, k := range llm.Providers() {
		out = append(out, string(k))
	}
	return out
}
