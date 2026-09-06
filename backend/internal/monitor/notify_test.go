package monitor

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestNotifierWebhookFormats(t *testing.T) {
	var mu sync.Mutex
	var bodies []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var m map[string]any
		_ = json.Unmarshal(b, &m)
		mu.Lock()
		bodies = append(bodies, m)
		mu.Unlock()
	}))
	defer srv.Close()

	mk := func(format string) *Notifier {
		return NewNotifier(func(string) Settings {
			return Settings{DefaultChannel: "webhook", Webhook: WebhookSettings{URL: srv.URL, Format: format}}
		}, nil)
	}
	mon := Monitor{Name: "api", Kind: "http", Target: "https://x/health", Owner: ""}

	if err := mk("generic").Send(context.Background(), mon, "down", "status 503"); err != nil {
		t.Fatal(err)
	}
	if err := mk("slack").Send(context.Background(), mon, "recovered", ""); err != nil {
		t.Fatal(err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 2 {
		t.Fatalf("got %d posts", len(bodies))
	}
	if bodies[0]["event"] != "down" || bodies[0]["monitor"] != "api" {
		t.Fatalf("generic body = %v", bodies[0])
	}
	if txt, _ := bodies[1]["text"].(string); txt == "" {
		t.Fatalf("slack body missing text: %v", bodies[1])
	}
}

func TestMuteAndTagFilter(t *testing.T) {
	s := newStore(t)
	a, _ := s.Put("u", Monitor{Name: "a", Kind: "icmp", Target: "1.1.1.1", Enabled: true, Tags: "prod, edge"})
	s.Put("u", Monitor{Name: "b", Kind: "icmp", Target: "8.8.8.8", Enabled: true, Tags: "staging"})

	if got, _ := s.List("u", "prod"); len(got) != 1 || got[0].Name != "a" {
		t.Fatalf("tag filter = %+v", got)
	}
	if got, _ := s.List("u", ""); len(got) != 2 {
		t.Fatalf("no filter = %d", len(got))
	}

	until := time.Now().Add(time.Hour).UnixMilli()
	m, err := s.SetMute("u", a.ID, until)
	if err != nil || m.MutedUntil != until {
		t.Fatalf("SetMute = %+v %v", m, err)
	}
	if m2, _ := s.SetMute("u", a.ID, 0); m2.MutedUntil != 0 {
		t.Fatalf("unmute left %d", m2.MutedUntil)
	}
}

func TestEngineNotifyPolicy(t *testing.T) {
	f := withFakeProbe(t)
	s := newStore(t)
	e := NewEngine(s)

	var mu sync.Mutex
	var events []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var m map[string]any
		_ = json.Unmarshal(b, &m)
		mu.Lock()
		events = append(events, m["event"].(string))
		mu.Unlock()
	}))
	defer srv.Close()

	e.SetNotifier(NewNotifier(func(string) Settings {
		return Settings{
			DefaultChannel:   "webhook",
			Webhook:          WebhookSettings{URL: srv.URL, Format: "generic"},
			NotifyOnRecovery: true,
		}
	}, nil))

	m, _ := s.Put("", Monitor{Name: "svc", Kind: "fake", Target: "x", Enabled: true, FailThreshold: 1, IntervalSec: 60})
	st := &loopState{}

	e.tick(context.Background(), m.ID, st) // ok → up, no alert
	f.ok.Store(false)
	e.tick(context.Background(), m.ID, st) // fail 1 (threshold 1) → down → "down" alert
	f.ok.Store(true)
	e.tick(context.Background(), m.ID, st) // ok → up → "recovered" alert

	// fire() is async
	deadline := time.After(2 * time.Second)
	for {
		mu.Lock()
		n := len(events)
		mu.Unlock()
		if n >= 2 {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("only got %d alerts: %v", n, events)
		case <-time.After(20 * time.Millisecond):
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if events[0] != "down" || events[1] != "recovered" {
		t.Fatalf("alerts = %v", events)
	}
}
