package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/sse"
)

// SecretResolver fetches an API key from the Vault by secret id. The Vault type
// satisfies this; a nil resolver means keyed connections are unusable.
type SecretResolver interface {
	Resolve(id string) (string, error)
}

// Engine runs model listing and chat against configured connections.
type Engine struct {
	Store   *Store
	Secrets SecretResolver

	mu    sync.Mutex
	cache map[string]modelCacheEntry
}

type modelCacheEntry struct {
	models []Model
	at     time.Time
}

const modelCacheTTL = 60 * time.Second

// NewEngine builds an engine.
func NewEngine(store *Store, secrets SecretResolver) *Engine {
	return &Engine{Store: store, Secrets: secrets, cache: map[string]modelCacheEntry{}}
}

// resolveKey returns the plaintext API key for a connection, or "" for a
// keyless one. The key never leaves the backend.
func (e *Engine) resolveKey(conn Connection) (string, error) {
	if conn.AuthSecretID == "" {
		return "", nil
	}
	if e.Secrets == nil {
		return "", fmt.Errorf("vault unavailable — cannot read this connection's key")
	}
	v, err := e.Secrets.Resolve(conn.AuthSecretID)
	if err != nil {
		return "", fmt.Errorf("read connection key: %w", err)
	}
	return v, nil
}

// TestConnection resolves the key and lists models — the "does this work" check.
func (e *Engine) TestConnection(ctx context.Context, id string) ([]Model, error) {
	conn, err := e.Store.GetConnection(id)
	if err != nil {
		return nil, err
	}
	key, err := e.resolveKey(*conn)
	if err != nil {
		return nil, err
	}
	p := For(conn.Provider)
	if p == nil {
		return nil, fmt.Errorf("unsupported provider %q", conn.Provider)
	}
	c, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	models, err := p.ListModels(c, *conn, key)
	if err != nil {
		return nil, err
	}
	e.putCache(id, models)
	return models, nil
}

// Models returns the connection's models, cached for modelCacheTTL. `force`
// bypasses the cache.
func (e *Engine) Models(ctx context.Context, id string, force bool) ([]Model, error) {
	if !force {
		if m, ok := e.getCache(id); ok {
			return m, nil
		}
	}
	return e.TestConnection(ctx, id)
}

// Chat streams a raw completion (playground). `out` is closed by the caller.
func (e *Engine) Chat(ctx context.Context, connID string, req ChatRequest, out chan<- sse.Message) {
	e.stream(ctx, connID, req, OutputText, out)
}

// RunTask renders a grounded task and streams the completion. `context` is the
// caller's grounding map ({{context.*}}), `input` the user's instruction,
// `history` prior turns (for chat mode). See AI_MODULE_PLAN.md §6.2.
func (e *Engine) RunTask(
	ctx context.Context, taskID, connID, model string,
	vars map[string]string, input string, history []ChatMessage,
	out chan<- sse.Message,
) {
	task, err := e.Store.GetTask(taskID)
	if err != nil {
		sendOrDone(ctx, out, sse.Message{Event: "error", Data: map[string]string{"error": "task not found: " + taskID}})
		return
	}
	system := RenderTask(*task, vars, input)
	msgs := make([]ChatMessage, 0, len(history)+2)
	msgs = append(msgs, ChatMessage{Role: "system", Content: system})
	msgs = append(msgs, history...)
	msgs = append(msgs, ChatMessage{Role: "user", Content: input})
	req := ChatRequest{Model: model, Messages: msgs, Temperature: task.Temperature}
	e.stream(ctx, connID, req, task.OutputShape, out)
}

// stream is the shared completion path: resolve the connection + key, run the
// provider, forward deltas, and — for a JSON-shaped task — emit a final
// `parsed` event with the extracted JSON.
func (e *Engine) stream(ctx context.Context, connID string, req ChatRequest, shape TaskOutputShape, out chan<- sse.Message) {
	send := func(m sse.Message) bool { return sendOrDone(ctx, out, m) }

	conn, err := e.Store.GetConnection(connID)
	if err != nil {
		send(sse.Message{Event: "error", Data: map[string]string{"error": "connection not found"}})
		return
	}
	key, err := e.resolveKey(*conn)
	if err != nil {
		send(sse.Message{Event: "error", Data: map[string]string{"error": err.Error()}})
		return
	}
	p := For(conn.Provider)
	if p == nil {
		send(sse.Message{Event: "error", Data: map[string]string{"error": "unsupported provider"}})
		return
	}
	if req.Model == "" {
		req.Model = conn.DefaultModel
	}
	if req.Model == "" {
		send(sse.Message{Event: "error", Data: map[string]string{"error": "no model selected"}})
		return
	}

	deltas := make(chan Delta, 64)
	var usage Usage
	var chatErr error
	done := make(chan struct{})
	go func() {
		usage, chatErr = p.Chat(ctx, *conn, key, req, deltas)
		close(deltas)
		close(done)
	}()
	// Always drain `deltas` so the provider goroutine never blocks on a send,
	// even if the client has gone and `out` is no longer being read.
	drain := func() {
		for range deltas {
		}
		<-done
	}

	if !send(sse.Message{Event: "start", Data: map[string]any{"model": req.Model, "provider": string(conn.Provider)}}) {
		drain()
		return
	}
	var full strings.Builder
	for d := range deltas {
		if d.Text == "" {
			continue
		}
		full.WriteString(d.Text)
		if !send(sse.Message{Event: "delta", Data: map[string]string{"text": d.Text}}) {
			drain()
			return
		}
	}
	<-done
	if chatErr != nil {
		send(sse.Message{Event: "error", Data: errData(chatErr)})
		return
	}
	if shape == OutputJSON {
		if j := extractJSON(full.String()); j != "" {
			send(sse.Message{Event: "parsed", Data: map[string]string{"json": j}})
		}
	}
	send(sse.Message{Event: "end", Data: map[string]any{
		"usage": map[string]int{"promptTokens": usage.PromptTokens, "completionTokens": usage.CompletionTokens},
	}})
}

// errData shapes an SSE `error` payload — `{error}` plus `code`+`hint` when the
// error was classified by internal/apierr.
func errData(err error) map[string]string {
	d := map[string]string{"error": err.Error()}
	var ae *apierr.Error
	if errors.As(err, &ae) {
		d["code"] = string(ae.Code)
		if ae.Hint != "" {
			d["hint"] = ae.Hint
		}
	}
	return d
}

// sendOrDone sends m on out, or returns false if ctx is cancelled first (the
// client disconnected). Prevents the streaming goroutine leaking on a full
// channel when nobody is reading it any more.
func sendOrDone(ctx context.Context, out chan<- sse.Message, m sse.Message) bool {
	select {
	case out <- m:
		return true
	case <-ctx.Done():
		return false
	}
}

// extractJSON pulls the first JSON object/array out of a model reply: a fenced
// ```json block if present, else the first balanced {...} / [...].
func extractJSON(s string) string {
	if i := strings.Index(s, "```"); i >= 0 {
		rest := s[i+3:]
		rest = strings.TrimPrefix(rest, "json")
		rest = strings.TrimPrefix(rest, "JSON")
		if end := strings.Index(rest, "```"); end >= 0 {
			cand := strings.TrimSpace(rest[:end])
			if json.Valid([]byte(cand)) {
				return cand
			}
		}
	}
	start := strings.IndexAny(s, "{[")
	if start < 0 {
		return ""
	}
	openCh := s[start]
	closeCh := byte('}')
	if openCh == '[' {
		closeCh = ']'
	}
	depth := 0
	for i := start; i < len(s); i++ {
		switch s[i] {
		case openCh:
			depth++
		case closeCh:
			depth--
			if depth == 0 {
				cand := s[start : i+1]
				if json.Valid([]byte(cand)) {
					return cand
				}
				return ""
			}
		}
	}
	return ""
}

// --- model cache ---------------------------------------------------

func (e *Engine) getCache(id string) ([]Model, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	ent, ok := e.cache[id]
	if !ok || time.Since(ent.at) > modelCacheTTL {
		return nil, false
	}
	return ent.models, true
}

func (e *Engine) putCache(id string, models []Model) {
	e.mu.Lock()
	e.cache[id] = modelCacheEntry{models: models, at: time.Now()}
	e.mu.Unlock()
}

// InvalidateCache drops a connection's cached model list (called on edit/delete).
func (e *Engine) InvalidateCache(id string) {
	e.mu.Lock()
	delete(e.cache, id)
	e.mu.Unlock()
}
