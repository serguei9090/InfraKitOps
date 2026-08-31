package llm

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/apierr"
)

// httpClient is shared by all adapters. No overall timeout — streamed chats can
// legitimately run for minutes; the request context carries the deadline.
var httpClient = &http.Client{
	Transport: &http.Transport{
		MaxIdleConns:        20,
		IdleConnTimeout:     90 * time.Second,
		DisableCompression:  false,
		TLSHandshakeTimeout: 10 * time.Second,
	},
}

// Provider is an adapter for one API shape. Implementations are stateless; the
// Connection + resolved key are passed per call.
type Provider interface {
	// ListModels queries the endpoint for its available models.
	ListModels(ctx context.Context, conn Connection, key string) ([]Model, error)
	// Chat streams a completion. Text deltas go to out; out is closed by the
	// caller, not here. The final token usage is returned.
	Chat(ctx context.Context, conn Connection, key string, req ChatRequest, out chan<- Delta) (Usage, error)
	// Kind is the provider this adapter serves.
	Kind() ProviderKind
	// KeylessOK reports whether this provider can be used with no API key
	// (true for local runtimes like ollama).
	KeylessOK() bool
}

// For returns the adapter for a kind, or nil if unimplemented.
func For(k ProviderKind) Provider {
	switch k {
	case ProviderOllama:
		return ollamaProvider{}
	case ProviderOpenAICompatible:
		return openAICompatibleProvider{}
	case ProviderAnthropic:
		return anthropicProvider{}
	case ProviderGemini:
		return geminiProvider{}
	default:
		return nil
	}
}

// Providers lists the provider kinds this build supports, for the capability
// payload and the connection editor.
func Providers() []ProviderKind {
	return []ProviderKind{ProviderOllama, ProviderOpenAICompatible, ProviderAnthropic, ProviderGemini}
}

// baseURL resolves a connection's endpoint, trimming a trailing slash.
func baseURL(conn Connection) string {
	u := strings.TrimRight(strings.TrimSpace(conn.BaseURL), "/")
	if u == "" {
		u = defaultBaseURL(conn.Provider)
	}
	return u
}

// netErr classifies a transport failure into an *apierr.Error (unreachable /
// timeout / …). `scrub`, if set, sanitises the message first (gemini's URL key).
// A cancelled-context error passes through unchanged.
func netErr(err error, scrub func(error) error) error {
	if scrub != nil {
		err = scrub(err)
	}
	if e := apierr.ClassifyNet(err); e != nil {
		return e
	}
	return err
}

// httpErr reads a bounded error body off a non-2xx response and classifies it
// (401→auth_failed, 429→rate_limited, …).
func httpErr(label string, resp *http.Response) error {
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
	return apierr.ClassifyHTTP(label, resp.StatusCode, string(bytes.TrimSpace(b)))
}

// contextErr maps a cancelled/expired context to a friendly message.
func contextErr(ctx context.Context) string {
	switch ctx.Err() {
	case context.DeadlineExceeded:
		return "timed out"
	case context.Canceled:
		return "cancelled"
	default:
		return ""
	}
}
