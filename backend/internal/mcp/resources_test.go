package mcp

import (
	"context"
	"strings"
	"testing"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// testManager wires the Manager to an in-memory SDK server via the dial seam.
func testManager(t *testing.T, configure func(*sdk.Server)) (*Manager, string, *sdk.Server) {
	t.Helper()
	store := newStore(t)
	id, err := store.Put(ServerConfig{
		Name: "test", Transport: TransportStdio, Command: "unused", Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	srv := sdk.NewServer(&sdk.Implementation{Name: "test-srv", Version: "0"}, nil)
	configure(srv)

	m := NewManager(store, nil, "test")
	m.dial = func(context.Context, ServerConfig) (sdk.Transport, error) {
		ct, st := sdk.NewInMemoryTransports()
		go func() { _ = srv.Run(context.Background(), st) }()
		return ct, nil
	}
	t.Cleanup(m.CloseAll)
	return m, id, srv
}

func TestResourcesRoundTrip(t *testing.T) {
	body := strings.Repeat("x", (32<<10)+500) // over the cap
	m, id, _ := testManager(t, func(s *sdk.Server) {
		s.AddResource(
			&sdk.Resource{URI: "test://doc", Name: "doc", Description: "a doc", MIMEType: "text/plain"},
			func(context.Context, *sdk.ReadResourceRequest) (*sdk.ReadResourceResult, error) {
				return &sdk.ReadResourceResult{
					Contents: []*sdk.ResourceContents{{URI: "test://doc", MIMEType: "text/plain", Text: body}},
				}, nil
			},
		)
		s.AddResourceTemplate(
			&sdk.ResourceTemplate{URITemplate: "test://f/{name}", Name: "file"},
			func(context.Context, *sdk.ReadResourceRequest) (*sdk.ReadResourceResult, error) {
				return &sdk.ReadResourceResult{Contents: []*sdk.ResourceContents{{URI: "test://f/x", Text: "hi"}}}, nil
			},
		)
	})
	ctx := context.Background()

	res, tmpl, err := m.Resources(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 1 || res[0].URI != "test://doc" || res[0].ServerName != "test" {
		t.Fatalf("resources: %+v", res)
	}
	if len(tmpl) != 1 || tmpl[0].URITemplate != "test://f/{name}" {
		t.Fatalf("templates: %+v", tmpl)
	}

	read, err := m.ReadResource(ctx, id, "test://doc")
	if err != nil {
		t.Fatal(err)
	}
	if len(read.Contents) != 1 || !read.Truncated {
		t.Fatalf("read: truncated=%v contents=%d", read.Truncated, len(read.Contents))
	}
	if len(read.Contents[0].Text) != 32<<10 {
		t.Fatalf("cap not applied: %d", len(read.Contents[0].Text))
	}

	if st := m.Statuses()[id]; st.ResourceCount != 1 {
		t.Fatalf("status resource count: %+v", st)
	}
}

func TestPromptsRoundTrip(t *testing.T) {
	m, id, _ := testManager(t, func(s *sdk.Server) {
		s.AddPrompt(
			&sdk.Prompt{
				Name:        "greet",
				Description: "say hi",
				Arguments:   []*sdk.PromptArgument{{Name: "who", Required: true}},
			},
			func(_ context.Context, r *sdk.GetPromptRequest) (*sdk.GetPromptResult, error) {
				who := r.Params.Arguments["who"]
				return &sdk.GetPromptResult{
					Description: "greeting",
					Messages: []*sdk.PromptMessage{
						{Role: "user", Content: &sdk.TextContent{Text: "Hello " + who}},
					},
				}, nil
			},
		)
	})
	ctx := context.Background()

	prompts, err := m.Prompts(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if len(prompts) != 1 || prompts[0].Name != "greet" || len(prompts[0].Arguments) != 1 || !prompts[0].Arguments[0].Required {
		t.Fatalf("prompts: %+v", prompts)
	}

	got, err := m.GetPrompt(ctx, id, "greet", map[string]string{"who": "Sam"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Messages) != 1 || got.Messages[0].Text != "Hello Sam" || got.Messages[0].Role != "user" {
		t.Fatalf("get prompt: %+v", got)
	}
}

func TestRPListChangedDropsCache(t *testing.T) {
	m, id, srv := testManager(t, func(s *sdk.Server) {
		s.AddPrompt(&sdk.Prompt{Name: "a"}, func(context.Context, *sdk.GetPromptRequest) (*sdk.GetPromptResult, error) {
			return &sdk.GetPromptResult{Messages: []*sdk.PromptMessage{}}, nil
		})
	})
	ctx := context.Background()

	if p, err := m.Prompts(ctx, id); err != nil || len(p) != 1 {
		t.Fatalf("initial prompts: %v %d", err, len(p))
	}

	// server-side change fires a prompts/list_changed notification
	srv.AddPrompt(&sdk.Prompt{Name: "b"}, func(context.Context, *sdk.GetPromptRequest) (*sdk.GetPromptResult, error) {
		return &sdk.GetPromptResult{Messages: []*sdk.PromptMessage{}}, nil
	})

	// the handler runs async; give it a beat, then the cache must be cold
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		m.mu.Lock()
		cold := m.conns[id] != nil && m.conns[id].rpAt.IsZero()
		m.mu.Unlock()
		if cold {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	p, err := m.Prompts(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if len(p) != 2 {
		t.Fatalf("expected re-list after change, got %d prompts", len(p))
	}
}
