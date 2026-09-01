package mcp

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/templating"
	"github.com/infrakit/backend/internal/userctx"
)

// Manager owns a live session per connected server and the tool cache.
type Manager struct {
	store   *Store
	secrets SecretResolver
	impl    *sdk.Implementation

	mu    sync.Mutex
	conns map[string]*conn

	statusMu sync.Mutex
	status   map[string]*ServerStatus

	// dial builds the SDK transport for a server. Defaults to m.transport;
	// overridden in tests to inject an in-memory transport.
	dial func(context.Context, ServerConfig) (sdk.Transport, error)
}

type conn struct {
	session *sdk.ClientSession
	cancel  context.CancelFunc

	tools []ToolSpec
	at    time.Time // tools cache stamp

	resources []ResourceSpec
	templates []ResourceTemplateSpec
	prompts   []PromptSpec
	rpAt      time.Time // resources+prompts cache stamp
}

// ServerStatus is the last-known health of one server (A4e-3).
type ServerStatus struct {
	Connected     bool   `json:"connected"`
	ToolCount     int    `json:"toolCount"`
	ResourceCount int    `json:"resourceCount,omitempty"`
	PromptCount   int    `json:"promptCount,omitempty"`
	ConnectedAt   int64  `json:"connectedAt,omitempty"`
	LastError     string `json:"lastError,omitempty"`
	LastErrorAt   int64  `json:"lastErrorAt,omitempty"`
}

// NewManager builds a manager. secrets may be nil (then {{secret:}} refs and
// http auth fail with a clear error).
func NewManager(store *Store, secrets SecretResolver, version string) *Manager {
	m := &Manager{
		store:   store,
		secrets: secrets,
		impl:    &sdk.Implementation{Name: "infrakit-studio", Version: version},
		conns:   map[string]*conn{},
		status:  map[string]*ServerStatus{},
	}
	m.dial = m.transport
	return m
}

func (m *Manager) markOK(id string, tools int) {
	m.statusMu.Lock()
	m.status[id] = &ServerStatus{Connected: true, ToolCount: tools, ConnectedAt: time.Now().UnixMilli()}
	m.statusMu.Unlock()
}

func (m *Manager) markRP(id string, resources, prompts int) {
	m.statusMu.Lock()
	if s := m.status[id]; s != nil {
		s.ResourceCount = resources
		s.PromptCount = prompts
	}
	m.statusMu.Unlock()
}

func (m *Manager) markErr(id string, err error) {
	m.statusMu.Lock()
	s := m.status[id]
	if s == nil {
		s = &ServerStatus{}
		m.status[id] = s
	}
	s.Connected = false
	s.LastError = err.Error()
	s.LastErrorAt = time.Now().UnixMilli()
	m.statusMu.Unlock()
}

func (m *Manager) markDown(id string) {
	m.statusMu.Lock()
	if s := m.status[id]; s != nil {
		s.Connected = false
	}
	m.statusMu.Unlock()
}

// Statuses returns a snapshot of every known server status.
func (m *Manager) Statuses() map[string]ServerStatus {
	m.statusMu.Lock()
	defer m.statusMu.Unlock()
	out := make(map[string]ServerStatus, len(m.status))
	for id, s := range m.status {
		out[id] = *s
	}
	return out
}

// Store exposes the registry (handlers use it directly for CRUD).
func (m *Manager) Store() *Store { return m.store }

// connectTimeout is generous on purpose: a stdio server run via `npx`/`uvx`
// downloads its package on first use, which can take well over 30s.
const connectTimeout = 60 * time.Second

// Connect opens (or reuses) a session to server id and refreshes its tool
// cache. Idempotent.
func (m *Manager) Connect(ctx context.Context, id string) ([]ToolSpec, error) {
	cfg, err := m.store.Get(userctx.From(ctx), id)
	if err != nil {
		return nil, err
	}

	m.mu.Lock()
	if c := m.conns[id]; c != nil {
		m.mu.Unlock()
		return m.refreshTools(ctx, id, cfg, c)
	}
	m.mu.Unlock()

	tr, err := m.dial(ctx, *cfg)
	if err != nil {
		e := apierr.Validation(err.Error())
		m.markErr(id, e)
		return nil, e
	}

	// The session outlives this request — give it its own cancelable context.
	_, cancel := context.WithCancel(context.Background())
	dialCtx, dialCancel := context.WithTimeout(ctx, connectTimeout)
	defer dialCancel()

	// A4e-1: when the server announces its tool list changed, drop our cache so
	// the next Tools()/AggregateTools() re-lists instead of waiting out the TTL.
	dropToolCache := func() {
		m.mu.Lock()
		if cc := m.conns[id]; cc != nil {
			cc.at = time.Time{}
		}
		m.mu.Unlock()
	}
	dropRPCache := func() {
		m.mu.Lock()
		if cc := m.conns[id]; cc != nil {
			cc.rpAt = time.Time{}
		}
		m.mu.Unlock()
	}
	client := sdk.NewClient(m.impl, &sdk.ClientOptions{
		ToolListChangedHandler:     func(context.Context, *sdk.ToolListChangedRequest) { dropToolCache() },
		ResourceListChangedHandler: func(context.Context, *sdk.ResourceListChangedRequest) { dropRPCache() },
		PromptListChangedHandler:   func(context.Context, *sdk.PromptListChangedRequest) { dropRPCache() },
	})
	session, err := client.Connect(dialCtx, tr, nil)
	if err != nil {
		cancel()
		e := classifyDial(err)
		m.markErr(id, e)
		return nil, e
	}

	c := &conn{session: session, cancel: cancel}
	m.mu.Lock()
	// lost a race — close ours, use theirs
	if existing := m.conns[id]; existing != nil {
		m.mu.Unlock()
		_ = session.Close()
		cancel()
		return m.refreshTools(ctx, id, cfg, existing)
	}
	m.conns[id] = c
	m.mu.Unlock()

	return m.refreshTools(ctx, id, cfg, c)
}

// Disconnect closes a session if open.
func (m *Manager) Disconnect(id string) {
	m.mu.Lock()
	c := m.conns[id]
	delete(m.conns, id)
	m.mu.Unlock()
	if c != nil {
		_ = c.session.Close()
		c.cancel()
	}
	m.markDown(id)
}

// Tools returns the cached tool list for a server, connecting if needed.
func (m *Manager) Tools(ctx context.Context, id string) ([]ToolSpec, error) {
	m.mu.Lock()
	c := m.conns[id]
	m.mu.Unlock()
	if c != nil && time.Since(c.at) < toolCacheTTL {
		if err := m.owns(ctx, id); err != nil {
			return nil, err
		}
		return c.tools, nil
	}
	return m.Connect(ctx, id)
}

const toolCacheTTL = 60 * time.Second

// AggregateTools lists tools across every ENABLED server. A server that fails
// to connect is skipped (its error is returned alongside if all fail).
func (m *Manager) AggregateTools(ctx context.Context) ([]ToolSpec, error) {
	servers, err := m.store.List(userctx.From(ctx))
	if err != nil {
		return nil, err
	}
	var out []ToolSpec
	var lastErr error
	var tried int
	for _, s := range servers {
		if !s.Enabled {
			continue
		}
		tried++
		tools, err := m.Tools(ctx, s.ID)
		if err != nil {
			lastErr = err
			continue
		}
		out = append(out, tools...)
	}
	if len(out) == 0 && tried > 0 && lastErr != nil {
		return nil, lastErr
	}
	return out, nil
}

// Call invokes a tool on a server. Used by the engine (A4b).
func (m *Manager) Call(ctx context.Context, serverID, tool string, args map[string]any) (ToolResult, error) {
	if err := m.owns(ctx, serverID); err != nil {
		return ToolResult{}, err
	}
	m.mu.Lock()
	c := m.conns[serverID]
	m.mu.Unlock()
	if c == nil {
		if _, err := m.Connect(ctx, serverID); err != nil {
			return ToolResult{}, err
		}
		m.mu.Lock()
		c = m.conns[serverID]
		m.mu.Unlock()
	}
	if c == nil {
		return ToolResult{}, apierr.Unreachable("mcp server not connected")
	}

	res, err := c.session.CallTool(ctx, &sdk.CallToolParams{Name: tool, Arguments: args})
	if err != nil {
		return ToolResult{}, apierr.Upstream("mcp tool call: " + err.Error())
	}

	var b strings.Builder
	for _, part := range res.Content {
		if tc, ok := part.(*sdk.TextContent); ok {
			b.WriteString(tc.Text)
		}
	}
	text := b.String()
	tr := ToolResult{Text: text, IsError: res.IsError}
	if len(text) > maxResultBytes {
		tr.Text = text[:maxResultBytes]
		tr.Truncated = true
	}
	return tr, nil
}

// CloseAll shuts every session down (backend exit).
func (m *Manager) CloseAll() {
	m.mu.Lock()
	conns := m.conns
	m.conns = map[string]*conn{}
	m.mu.Unlock()
	for _, c := range conns {
		_ = c.session.Close()
		c.cancel()
	}
}

func (m *Manager) refreshTools(ctx context.Context, id string, cfg *ServerConfig, c *conn) ([]ToolSpec, error) {
	lctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	list, err := c.session.ListTools(lctx, nil)
	if err != nil {
		// session is probably dead — drop it so the next call reconnects
		m.Disconnect(id)
		e := apierr.Upstream("mcp tools/list: " + err.Error())
		m.markErr(id, e)
		return nil, e
	}
	out := make([]ToolSpec, 0, len(list.Tools))
	for _, t := range list.Tools {
		if !cfg.allowed(t.Name) {
			continue
		}
		spec := ToolSpec{
			Server:        cfg.ID,
			ServerName:    cfg.Name,
			Name:          t.Name,
			QualifiedName: cfg.ID + "__" + t.Name,
			Description:   t.Description,
			InputSchema:   t.InputSchema,
		}
		if t.Annotations != nil {
			spec.ReadOnly = t.Annotations.ReadOnlyHint
			spec.Title = t.Annotations.Title
		}
		out = append(out, spec)
	}
	m.mu.Lock()
	c.tools = out
	c.at = time.Now()
	m.mu.Unlock()
	m.markOK(id, len(out))
	return out, nil
}

func (m *Manager) transport(ctx context.Context, cfg ServerConfig) (sdk.Transport, error) {
	switch cfg.Transport {
	case TransportStdio:
		if _, err := exec.LookPath(cfg.Command); err != nil {
			return nil, fmt.Errorf("command %q not found on PATH", cfg.Command)
		}
		cmd := exec.Command(cfg.Command, cfg.Args...)
		env, err := m.buildEnv(ctx, cfg.Env)
		if err != nil {
			return nil, err
		}
		cmd.Env = env
		return &sdk.CommandTransport{Command: cmd}, nil

	case TransportHTTP:
		hc := &http.Client{} // no overall timeout — SSE streams are long-lived
		if cfg.AuthSecretID != "" {
			if m.secrets == nil {
				return nil, errors.New("this server needs a vault secret, but the vault is locked/unavailable")
			}
			key, err := m.secrets.Resolve(ctx, cfg.AuthSecretID)
			if err != nil {
				return nil, fmt.Errorf("resolve auth secret: %w", err)
			}
			hc.Transport = &bearerRT{key: key, base: http.DefaultTransport}
		}
		return &sdk.StreamableClientTransport{Endpoint: cfg.URL, HTTPClient: hc}, nil

	default:
		return nil, errors.New("unknown transport")
	}
}

// buildEnv starts from PATH only and adds the config's env, resolving
// {{secret:NAME}} against the calling user's vault. Nothing else from the
// backend's own environment is passed through.
func (m *Manager) buildEnv(ctx context.Context, env map[string]string) ([]string, error) {
	out := []string{"PATH=" + os.Getenv("PATH")}
	if sys := os.Getenv("SystemRoot"); sys != "" {
		out = append(out, "SystemRoot="+sys) // Windows: many tools break without it
	}
	var resolveErr error
	for k, v := range env {
		val := templating.Substitute(v, func(name string) (string, bool) {
			ref, ok := strings.CutPrefix(name, "secret:")
			if !ok {
				return "", false
			}
			if m.secrets == nil {
				resolveErr = errors.New("env references a vault secret, but the vault is locked/unavailable")
				return "", false
			}
			s, err := m.secrets.ResolveByName(ctx, ref)
			if err != nil {
				resolveErr = fmt.Errorf("resolve secret %q: %w", ref, err)
				return "", false
			}
			return s, true
		})
		out = append(out, k+"="+val)
	}
	return out, resolveErr
}

type bearerRT struct {
	key  string
	base http.RoundTripper
}

func (b *bearerRT) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.key)
	return b.base.RoundTrip(r)
}

func classifyDial(err error) error {
	s := strings.ToLower(err.Error())
	switch {
	case strings.Contains(s, "not found"), strings.Contains(s, "no such file"):
		return apierr.Validation("mcp server command failed to start: " + err.Error())
	case strings.Contains(s, "connection refused"), strings.Contains(s, "dial"):
		return apierr.Unreachable("mcp server unreachable: " + err.Error())
	case strings.Contains(s, "timeout"), strings.Contains(s, "deadline"):
		return apierr.Timeout("mcp server did not respond: " + err.Error())
	default:
		return apierr.Upstream("mcp connect: " + err.Error())
	}
}
