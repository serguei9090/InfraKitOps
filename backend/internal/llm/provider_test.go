package llm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/infrakit/backend/internal/sse"
)

func collect(t *testing.T, p Provider, conn Connection, key string, req ChatRequest) (string, Usage) {
	t.Helper()
	out := make(chan Delta, 64)
	var text strings.Builder
	var usage Usage
	var err error
	done := make(chan struct{})
	go func() {
		usage, err = p.Chat(context.Background(), conn, key, req, out)
		close(out)
		close(done)
	}()
	for d := range out {
		text.WriteString(d.Text)
	}
	<-done
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	return text.String(), usage
}

func TestOpenAICompatibleProvider(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			t.Errorf("missing/wrong auth header: %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/v1/models":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"}]}`))
		case "/v1/chat/completions":
			w.Header().Set("Content-Type", "text/event-stream")
			w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n"))
			w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n"))
			w.Write([]byte("data: {\"choices\":[],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":2}}\n\n"))
			w.Write([]byte("data: [DONE]\n\n"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	p := openAICompatibleProvider{}
	conn := Connection{Provider: ProviderOpenAICompatible, BaseURL: srv.URL}

	models, err := p.ListModels(context.Background(), conn, "sk-test")
	if err != nil || len(models) != 2 || models[0].ID != "gpt-4o" {
		t.Fatalf("ListModels = %+v err %v", models, err)
	}

	text, usage := collect(t, p, conn, "sk-test", ChatRequest{Model: "gpt-4o", Messages: []ChatMessage{{Role: "user", Content: "hi"}}})
	if text != "Hello" {
		t.Fatalf("text = %q", text)
	}
	if usage.PromptTokens != 9 || usage.CompletionTokens != 2 {
		t.Fatalf("usage = %+v", usage)
	}
}

func TestOllamaProvider(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/tags":
			w.Write([]byte(`{"models":[{"name":"llama3.1:8b"},{"name":"qwen2.5:7b"}]}`))
		case "/api/chat":
			w.Write([]byte("{\"message\":{\"content\":\"Hi \"},\"done\":false}\n"))
			w.Write([]byte("{\"message\":{\"content\":\"there\"},\"done\":false}\n"))
			w.Write([]byte("{\"done\":true,\"prompt_eval_count\":5,\"eval_count\":3}\n"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	p := ollamaProvider{}
	conn := Connection{Provider: ProviderOllama, BaseURL: srv.URL}

	models, err := p.ListModels(context.Background(), conn, "")
	if err != nil || len(models) != 2 || models[1].ID != "qwen2.5:7b" {
		t.Fatalf("ListModels = %+v err %v", models, err)
	}

	text, usage := collect(t, p, conn, "", ChatRequest{Model: "llama3.1:8b", Messages: []ChatMessage{{Role: "user", Content: "hi"}}})
	if text != "Hi there" {
		t.Fatalf("text = %q", text)
	}
	if usage.PromptTokens != 5 || usage.CompletionTokens != 3 {
		t.Fatalf("usage = %+v", usage)
	}
}

func TestEngineChatOverSSE(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/chat" {
			w.Write([]byte("{\"message\":{\"content\":\"pong\"},\"done\":false}\n"))
			w.Write([]byte("{\"done\":true,\"prompt_eval_count\":1,\"eval_count\":1}\n"))
		}
	}))
	defer srv.Close()

	s := newStore(t)
	conn, _ := s.PutConnection(Connection{Name: "L", Provider: ProviderOllama, BaseURL: srv.URL})
	eng := NewEngine(s, nil)

	ch := make(chan sse.Message, 64)
	go func() {
		eng.Chat(context.Background(), conn.ID, ChatRequest{Model: "m", Messages: []ChatMessage{{Role: "user", Content: "ping"}}}, ch)
		close(ch)
	}()

	var text strings.Builder
	var sawEnd bool
	deadline := time.After(5 * time.Second)
	for done := false; !done; {
		select {
		case m, ok := <-ch:
			if !ok {
				done = true
				break
			}
			switch m.Event {
			case "delta":
				text.WriteString(m.Data.(map[string]string)["text"])
			case "end":
				sawEnd = true
			case "error":
				t.Fatalf("engine error: %v", m.Data)
			}
		case <-deadline:
			t.Fatal("engine chat timed out")
		}
	}
	if text.String() != "pong" || !sawEnd {
		t.Fatalf("streamed text = %q sawEnd = %v", text.String(), sawEnd)
	}
}
