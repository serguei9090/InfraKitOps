package llm

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/infrakit/backend/internal/sse"
)

type fakeRunner struct {
	calls []string
}

func (f *fakeRunner) Call(_ context.Context, serverID, tool string, args map[string]any) (ToolCallOutput, error) {
	f.calls = append(f.calls, serverID+"/"+tool)
	return ToolCallOutput{Text: fmt.Sprintf("result of %s(%v)", tool, args["q"])}, nil
}

// TestAgentLoopRunsToolThenAnswers: an OpenAI-shaped server that asks for a
// tool on the first call and answers on the second. The engine must run the
// tool via the runner and feed the result back.
func TestAgentLoopRunsToolThenAnswers(t *testing.T) {
	var round int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/v1/chat/completions") {
			w.WriteHeader(404)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		body := string(raw)
		round++
		fl := w.(http.Flusher)
		if round == 1 {
			// sanity: the tool list was sent
			if !strings.Contains(body, "srv1__search") {
				t.Errorf("round 1 payload missing tool: %s", body)
			}
			io := `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"srv1__search","arguments":"{\"q\":\"unix pipes\"}"}}]}}]}` + "\n\n"
			io += "data: [DONE]\n\n"
			fmt.Fprint(w, io)
			fl.Flush()
			return
		}
		// round 2: the tool result must be in the history
		if !strings.Contains(body, "result of search") {
			t.Errorf("round 2 payload missing tool result: %s", body)
		}
		fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"pipes connect stdout to stdin"}}]}`+"\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
		fl.Flush()
	}))
	defer srv.Close()

	s := newStore(t)
	conn, _ := s.PutConnection(Connection{Name: "O", Provider: ProviderOpenAICompatible, BaseURL: srv.URL})
	eng := NewEngine(s, nil)
	fr := &fakeRunner{}
	eng.SetToolRunner(fr)

	out := make(chan sse.Message, 64)
	req := ChatRequest{
		Model:    "m",
		Messages: []ChatMessage{{Role: "user", Content: "explain unix pipes"}},
		Tools:    []ToolDef{{Name: "srv1__search", Description: "search", Parameters: map[string]any{"type": "object"}}},
	}
	done := make(chan struct{})
	go func() { eng.stream(context.Background(), conn.ID, req, OutputText, out); close(out); close(done) }()

	var events []string
	var answer strings.Builder
	for m := range out {
		events = append(events, m.Event)
		if m.Event == "delta" {
			answer.WriteString(m.Data.(map[string]string)["text"])
		}
	}
	<-done

	if len(fr.calls) != 1 || fr.calls[0] != "srv1/search" {
		t.Fatalf("tool runner calls = %v, want [srv1/search]", fr.calls)
	}
	joined := strings.Join(events, ",")
	if !strings.Contains(joined, "tool-call") || !strings.Contains(joined, "tool-result") {
		t.Fatalf("missing tool events: %s", joined)
	}
	if got := answer.String(); !strings.Contains(got, "pipes connect stdout") {
		t.Fatalf("final answer = %q", got)
	}
	if round != 2 {
		t.Fatalf("provider rounds = %d, want 2", round)
	}
}

