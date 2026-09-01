package llm

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/infrakit/backend/internal/sse"
)

func TestStreamStopsWhenClientGone(t *testing.T) {
	// A server that streams forever.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/chat" {
			return
		}
		fl, _ := w.(http.Flusher)
		for i := 0; i < 10000; i++ {
			select {
			case <-r.Context().Done():
				return
			default:
			}
			w.Write([]byte("{\"message\":{\"content\":\"x\"},\"done\":false}\n"))
			if fl != nil {
				fl.Flush()
			}
			time.Sleep(time.Millisecond)
		}
	}))
	defer srv.Close()

	s := newStore(t)
	conn, _ := s.PutConnection(Connection{Name: "L", Provider: ProviderOllama, BaseURL: srv.URL})
	eng := NewEngine(s, nil)

	// tiny unbuffered channel, and we stop reading after the first message
	out := make(chan sse.Message)
	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan struct{})
	go func() {
		eng.stream(ctx, conn.ID, ChatRequest{Model: "m", Messages: []ChatMessage{{Role: "user", Content: "hi"}}}, OutputText, out)
		close(finished)
	}()

	<-out    // consume the "start" event
	cancel() // client disconnects; nobody reads `out` any more

	select {
	case <-finished:
		// stream returned promptly — no leak
	case <-time.After(5 * time.Second):
		t.Fatal("stream did not return after the context was cancelled — goroutine leak")
	}
}

func TestScrubKey(t *testing.T) {
	key := "AIzaSecretKey123"
	err := errors.New(`Post "https://x/v1beta/models/m:streamGenerateContent?alt=sse&key=AIzaSecretKey123": dial tcp: timeout`)
	got := scrubKey(err, key)
	if got == nil || contains(got.Error(), key) {
		t.Fatalf("key not scrubbed: %v", got)
	}
	if scrubKey(nil, key) != nil {
		t.Fatal("nil in nil out")
	}
	plain := errors.New("no key here")
	if scrubKey(plain, key) != plain {
		t.Fatal("unrelated error should pass through unchanged")
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func TestPerConnectionConcurrencyCap(t *testing.T) {
	var inflight, peak int32
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		inflight++
		if inflight > peak {
			peak = inflight
		}
		mu.Unlock()
		time.Sleep(120 * time.Millisecond)
		fl, _ := w.(http.Flusher)
		w.Write([]byte("{\"message\":{\"content\":\"x\"},\"done\":true,\"prompt_eval_count\":1,\"eval_count\":1}\n"))
		if fl != nil {
			fl.Flush()
		}
		mu.Lock()
		inflight--
		mu.Unlock()
	}))
	defer srv.Close()

	s := newStore(t)
	conn, _ := s.PutConnection(Connection{Name: "L", Provider: ProviderOllama, BaseURL: srv.URL})
	eng := NewEngine(s, nil)
	eng.SetMaxConcurrentPerConn(2)

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out := make(chan sse.Message, 64)
			go func() {
				eng.stream(context.Background(), conn.ID,
					ChatRequest{Model: "m", Messages: []ChatMessage{{Role: "user", Content: "hi"}}}, OutputText, out)
				close(out)
			}()
			for range out { //nolint:revive
			}
		}()
	}
	wg.Wait()

	if peak > 2 {
		t.Fatalf("peak concurrency = %d, want <= 2", peak)
	}
}
