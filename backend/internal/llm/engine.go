package llm

import (
	"context"
	"fmt"
	"sync"
	"time"

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

// Chat streams a completion from the connection to `out`. `out` is closed by
// the caller. Returns the token usage.
func (e *Engine) Chat(ctx context.Context, connID string, req ChatRequest, out chan<- sse.Message) {
	conn, err := e.Store.GetConnection(connID)
	if err != nil {
		out <- sse.Message{Event: "error", Data: map[string]string{"error": "connection not found"}}
		return
	}
	key, err := e.resolveKey(*conn)
	if err != nil {
		out <- sse.Message{Event: "error", Data: map[string]string{"error": err.Error()}}
		return
	}
	p := For(conn.Provider)
	if p == nil {
		out <- sse.Message{Event: "error", Data: map[string]string{"error": "unsupported provider"}}
		return
	}
	if req.Model == "" {
		req.Model = conn.DefaultModel
	}
	if req.Model == "" {
		out <- sse.Message{Event: "error", Data: map[string]string{"error": "no model selected"}}
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

	out <- sse.Message{Event: "start", Data: map[string]any{"model": req.Model, "provider": string(conn.Provider)}}
	for d := range deltas {
		if d.Text != "" {
			out <- sse.Message{Event: "delta", Data: map[string]string{"text": d.Text}}
		}
	}
	<-done
	if chatErr != nil {
		out <- sse.Message{Event: "error", Data: map[string]string{"error": chatErr.Error()}}
		return
	}
	out <- sse.Message{Event: "end", Data: map[string]any{
		"usage": map[string]int{"promptTokens": usage.PromptTokens, "completionTokens": usage.CompletionTokens},
	}}
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
