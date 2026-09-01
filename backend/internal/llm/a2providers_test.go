package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/infrakit/backend/internal/sse"
)

func readJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}

func TestAnthropicProvider(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "sk-ant" || r.Header.Get("anthropic-version") == "" {
			t.Errorf("bad headers: %v", r.Header)
		}
		switch r.URL.Path {
		case "/v1/models":
			w.Write([]byte(`{"data":[{"id":"claude-3-5-sonnet"},{"id":"claude-3-5-haiku"}]}`))
		case "/v1/messages":
			var body map[string]any
			_ = readJSON(r, &body)
			if body["system"] != "be terse" {
				t.Errorf("system not split out: %v", body["system"])
			}
			if _, ok := body["max_tokens"]; !ok {
				t.Errorf("max_tokens missing")
			}
			w.Header().Set("Content-Type", "text/event-stream")
			w.Write([]byte("event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":11}}}\n\n"))
			w.Write([]byte("event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"Hel\"}}\n\n"))
			w.Write([]byte("event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"lo\"}}\n\n"))
			w.Write([]byte("event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":2}}\n\n"))
			w.Write([]byte("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	p := anthropicProvider{}
	conn := Connection{Provider: ProviderAnthropic, BaseURL: srv.URL}

	models, err := p.ListModels(context.Background(), conn, "sk-ant")
	if err != nil || len(models) != 2 {
		t.Fatalf("ListModels = %+v err %v", models, err)
	}

	text, usage := collect(t, p, conn, "sk-ant", ChatRequest{
		Model:    "claude-3-5-haiku",
		Messages: []ChatMessage{{Role: "system", Content: "be terse"}, {Role: "user", Content: "hi"}},
	})
	if text != "Hello" || usage.PromptTokens != 11 || usage.CompletionTokens != 2 {
		t.Fatalf("text=%q usage=%+v", text, usage)
	}
}

func TestGeminiProvider(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("key") != "g-key" {
			t.Errorf("key not in query: %s", r.URL.RawQuery)
		}
		switch {
		case r.URL.Path == "/v1beta/models":
			w.Write([]byte(`{"models":[
				{"name":"models/gemini-2.0-flash","supportedGenerationMethods":["generateContent"]},
				{"name":"models/embedding-001","supportedGenerationMethods":["embedContent"]}
			]}`))
		case strings.HasSuffix(r.URL.Path, ":streamGenerateContent"):
			var body map[string]any
			_ = readJSON(r, &body)
			if _, ok := body["systemInstruction"]; !ok {
				t.Errorf("systemInstruction missing: %v", body)
			}
			w.Header().Set("Content-Type", "text/event-stream")
			w.Write([]byte("data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hi \"}]}}]}\n\n"))
			w.Write([]byte("data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"there\"}]}}],\"usageMetadata\":{\"promptTokenCount\":7,\"candidatesTokenCount\":3}}\n\n"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	p := geminiProvider{}
	conn := Connection{Provider: ProviderGemini, BaseURL: srv.URL}

	models, err := p.ListModels(context.Background(), conn, "g-key")
	if err != nil || len(models) != 1 || models[0].ID != "gemini-2.0-flash" {
		t.Fatalf("ListModels = %+v err %v", models, err)
	}

	text, usage := collect(t, p, conn, "g-key", ChatRequest{
		Model:    "gemini-2.0-flash",
		Messages: []ChatMessage{{Role: "system", Content: "sys"}, {Role: "user", Content: "hi"}},
	})
	if text != "Hi there" || usage.PromptTokens != 7 || usage.CompletionTokens != 3 {
		t.Fatalf("text=%q usage=%+v", text, usage)
	}
}

func TestGeminiSchemaStripsUnsupportedKeys(t *testing.T) {
	in := map[string]any{
		"$schema":              "http://json-schema.org/draft-07/schema#",
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"q": map[string]any{"type": "string", "$comment": "the query"},
			"opts": map[string]any{
				"type":                 "object",
				"additionalProperties": true,
				"properties":           map[string]any{"n": map[string]any{"type": "integer"}},
			},
		},
		"anyOf": []any{
			map[string]any{"required": []any{"q"}, "$id": "x"},
		},
	}
	out := geminiSchema(in).(map[string]any)
	for _, bad := range []string{"$schema", "additionalProperties"} {
		if _, ok := out[bad]; ok {
			t.Fatalf("top-level %q not stripped", bad)
		}
	}
	props := out["properties"].(map[string]any)
	if _, ok := props["q"].(map[string]any)["$comment"]; ok {
		t.Fatal("$comment not stripped from a nested property")
	}
	if _, ok := props["opts"].(map[string]any)["additionalProperties"]; ok {
		t.Fatal("additionalProperties not stripped from a nested object")
	}
	if _, ok := out["anyOf"].([]any)[0].(map[string]any)["$id"]; ok {
		t.Fatal("$id not stripped inside an anyOf branch")
	}
	// preserved
	if out["type"] != "object" || props["q"].(map[string]any)["type"] != "string" {
		t.Fatalf("real fields lost: %+v", out)
	}
}

// TestGeminiEchoesThoughtSignature: a Gemini "thinking" model returns a
// thoughtSignature with its functionCall; the follow-up request must echo it
// back on the model turn or Gemini 400s.
func TestGeminiEchoesThoughtSignature(t *testing.T) {
	var round int
	var round2Body string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		round++
		fl := w.(http.Flusher)
		if round == 1 {
			fmt.Fprint(w, `data: {"candidates":[{"content":{"parts":[`+
				`{"functionCall":{"name":"srv1__do","args":{}},"thoughtSignature":"SIG-ABC"}`+
				`]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":1}}`+"\n\n")
			fl.Flush()
			return
		}
		round2Body = string(raw)
		fmt.Fprint(w, `data: {"candidates":[{"content":{"parts":[{"text":"done"}]}}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":1}}`+"\n\n")
		fl.Flush()
	}))
	defer srv.Close()

	s := newStore(t)
	conn, _ := s.PutConnection(Connection{Name: "G", Provider: ProviderGemini, BaseURL: srv.URL, AuthSecretID: ""})
	eng := NewEngine(s, nil)
	eng.SetToolRunner(&fakeRunner{})

	out := make(chan sse.Message, 64)
	req := ChatRequest{
		Model:    "gemini-x",
		Messages: []ChatMessage{{Role: "user", Content: "go"}},
		Tools:    []ToolDef{{Name: "srv1__do", Description: "d", Parameters: map[string]any{"type": "object"}, ReadOnly: true}},
	}
	go func() { eng.stream(context.Background(), conn.ID, "", req, OutputText, out); close(out) }()
	for range out { //nolint:revive
	}

	if round != 2 {
		t.Fatalf("rounds = %d", round)
	}
	if !strings.Contains(round2Body, "SIG-ABC") || !strings.Contains(round2Body, "thoughtSignature") {
		t.Fatalf("round 2 did not echo the thoughtSignature: %s", round2Body)
	}
}
