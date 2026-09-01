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

// ToolRunner executes a tool call routed by qualified name. *mcp.Manager
// satisfies it; kept as an interface so internal/llm doesn't hard-depend on
// internal/mcp for tests.
type ToolRunner interface {
	Call(ctx context.Context, serverID, tool string, args map[string]any) (ToolCallOutput, error)
}

// ToolCallOutput is the flattened result of one tool call.
type ToolCallOutput struct {
	Text      string
	IsError   bool
	Truncated bool
}

// maxToolIterations bounds the agent loop per turn.
const maxToolIterations = 6

// Engine runs model listing and chat against configured connections.
type Engine struct {
	Store   *Store
	Secrets SecretResolver

	tools ToolRunner

	mu    sync.Mutex
	cache map[string]modelCacheEntry
}

// SetToolRunner wires the MCP tool runner (A4b). Nil → tool-enabled requests
// still work but every tool call reports "tools unavailable".
func (e *Engine) SetToolRunner(t ToolRunner) { e.tools = t }

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
	vars map[string]string, input string, history []ChatMessage, tools []ToolDef,
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
	req := ChatRequest{Model: model, Messages: msgs, Temperature: task.Temperature, Tools: tools}
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

	if !send(sse.Message{Event: "start", Data: map[string]any{"model": req.Model, "provider": string(conn.Provider)}}) {
		return
	}

	// Only offer tools if a runner is wired; otherwise strip them so the
	// provider doesn't advertise tools we can't execute.
	if hasTools(req) && e.tools == nil {
		req.Tools = nil
	}
	iters := 1
	if hasTools(req) {
		iters = maxToolIterations
	}

	var total Usage
	var lastText string
	for iter := 0; iter < iters; iter++ {
		res, text, ok, err := e.runChat(ctx, p, *conn, key, req, send)
		if !ok {
			return // client gone, already drained
		}
		total.PromptTokens += res.Usage.PromptTokens
		total.CompletionTokens += res.Usage.CompletionTokens
		lastText = text
		if err != nil {
			send(sse.Message{Event: "error", Data: errData(err)})
			return
		}
		if len(res.ToolCalls) == 0 {
			break
		}
		if iter == iters-1 {
			send(sse.Message{Event: "error", Data: map[string]string{
				"error": "the model kept calling tools without answering (limit reached)",
				"code":  string(apierr.CodeValidation),
			}})
			return
		}

		req.Messages = append(req.Messages, ChatMessage{Role: "assistant", Content: text, ToolCalls: res.ToolCalls})
		for _, tc := range res.ToolCalls {
			if !send(sse.Message{Event: "tool-call", Data: map[string]any{
				"id": tc.ID, "name": tc.Name, "args": tc.Args,
			}}) {
				return
			}
			outText, isErr := e.callTool(ctx, tc)
			if !send(sse.Message{Event: "tool-result", Data: map[string]any{
				"id": tc.ID, "name": tc.Name, "ok": !isErr, "text": outText,
			}}) {
				return
			}
			req.Messages = append(req.Messages, ChatMessage{
				Role: "tool", ToolCallID: tc.ID, Name: tc.Name, Content: outText,
			})
		}
	}

	if shape == OutputJSON {
		if j := extractJSON(lastText); j != "" {
			send(sse.Message{Event: "parsed", Data: map[string]string{"json": j}})
		}
	}
	send(sse.Message{Event: "end", Data: map[string]any{
		"usage": map[string]int{"promptTokens": total.PromptTokens, "completionTokens": total.CompletionTokens},
	}})
}

// runChat runs one provider Chat call, streaming `delta` events. Returns the
// result, the accumulated text, ok=false if the client disconnected mid-stream
// (already drained), and any provider error.
func (e *Engine) runChat(
	ctx context.Context, p Provider, conn Connection, key string, req ChatRequest,
	send func(sse.Message) bool,
) (ChatResult, string, bool, error) {
	deltas := make(chan Delta, 64)
	var res ChatResult
	var chatErr error
	done := make(chan struct{})
	go func() {
		res, chatErr = p.Chat(ctx, conn, key, req, deltas)
		close(deltas)
		close(done)
	}()
	drain := func() {
		for range deltas {
		}
		<-done
	}

	var full strings.Builder
	for d := range deltas {
		if d.Text == "" {
			continue
		}
		full.WriteString(d.Text)
		if !send(sse.Message{Event: "delta", Data: map[string]string{"text": d.Text}}) {
			drain()
			return ChatResult{}, "", false, nil
		}
	}
	<-done
	return res, full.String(), true, chatErr
}

// callTool routes a ToolCall (qualified name "<serverId>__<tool>") through the
// MCP manager. Returns the result text and whether it was an error.
func (e *Engine) callTool(ctx context.Context, tc ToolCall) (string, bool) {
	if e.tools == nil {
		return "tools are not available (no MCP layer)", true
	}
	serverID, tool, found := strings.Cut(tc.Name, "__")
	if !found {
		return "malformed tool name: " + tc.Name, true
	}
	res, err := e.tools.Call(ctx, serverID, tool, tc.Args)
	if err != nil {
		return "tool call failed: " + err.Error(), true
	}
	text := res.Text
	if res.Truncated {
		text += "\n…(truncated)"
	}
	return text, res.IsError
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
