package runstream

import (
	"context"
	"testing"
	"time"

	"github.com/infrakit/backend/internal/sse"
)

// collect drains a subscription channel into the ordered list of event names,
// failing if it doesn't close within a second.
func collect(t *testing.T, ch <-chan sse.Message) []string {
	t.Helper()
	var got []string
	timeout := time.After(time.Second)
	for {
		select {
		case m, ok := <-ch:
			if !ok {
				return got
			}
			got = append(got, m.Event)
		case <-timeout:
			t.Fatalf("subscription did not close; got so far: %v", got)
			return got
		}
	}
}

func subscribe(t *testing.T, h *Hub, key Key) <-chan sse.Message {
	t.Helper()
	ch := make(chan sse.Message, 64)
	go h.Subscribe(context.Background(), key, ch)
	return ch
}

func TestReplayAfterFinish(t *testing.T) {
	h := New(t.TempDir())
	key := Key{Module: "ansible", ID: 1}

	emit, err := h.Start(key, Meta{Owner: "u", Target: "site.yml"}, func() {})
	if err != nil {
		t.Fatal(err)
	}
	emit("run-start", map[string]any{"runId": 1})
	emit("stdout", map[string]any{"text": "hello"})
	emit("run-end", map[string]any{"status": "ok"})
	h.Finish(key, "ok")

	got := collect(t, subscribe(t, h, key))
	want := []string{"run-start", "stdout", "run-end"}
	if len(got) != len(want) {
		t.Fatalf("got %v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("event %d: got %q want %q", i, got[i], want[i])
		}
	}
}

func TestLiveSubscribeReplaysThenTails(t *testing.T) {
	h := New(t.TempDir())
	key := Key{Module: "ansible", ID: 2}
	emit, _ := h.Start(key, Meta{}, func() {})
	emit("a", nil)

	ch := make(chan sse.Message, 64)
	go h.Subscribe(context.Background(), key, ch)

	if m := <-ch; m.Event != "a" {
		t.Fatalf("replay: got %q want a", m.Event)
	}
	emit("b", nil)
	if m := <-ch; m.Event != "b" {
		t.Fatalf("live: got %q want b", m.Event)
	}
	h.Finish(key, "ok")
	if _, ok := <-ch; ok {
		t.Fatal("channel should close after Finish")
	}
}

func TestSubscribeUnknownKey(t *testing.T) {
	h := New(t.TempDir())
	got := collect(t, subscribe(t, h, Key{Module: "ansible", ID: 99}))
	if len(got) != 0 {
		t.Fatalf("expected no events, got %v", got)
	}
}

func TestCancel(t *testing.T) {
	h := New(t.TempDir())
	key := Key{Module: "runbook", ID: 3}
	ctx, cancel := context.WithCancel(context.Background())
	if _, err := h.Start(key, Meta{}, cancel); err != nil {
		t.Fatal(err)
	}
	if !h.Cancel(key) {
		t.Fatal("Cancel returned false for an active run")
	}
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("cancel did not propagate to the run context")
	}
	// The run goroutine reacts to the cancelled context by calling Finish.
	h.Finish(key, "cancelled")
	if h.Cancel(key) {
		t.Fatal("Cancel should return false once the run is gone")
	}
}

func TestActiveAndSupersede(t *testing.T) {
	h := New(t.TempDir())
	k1 := Key{Module: "ansible", ID: 10}
	k2 := Key{Module: "ansible", ID: 11}
	e1, _ := h.Start(k1, Meta{Target: "one"}, func() {})
	time.Sleep(2 * time.Millisecond)
	h.Start(k2, Meta{Target: "two"}, func() {})

	act := h.Active()
	if len(act) != 2 {
		t.Fatalf("want 2 active, got %d", len(act))
	}
	if act[0].ID != 11 {
		t.Fatalf("want newest (11) first, got %d", act[0].ID)
	}

	// A second Start on k1 supersedes the first: its subscribers get EOF.
	ch := subscribe(t, h, k1)
	e1("late", nil) // still the old run
	h.Start(k1, Meta{Target: "one-again"}, func() {})
	collect(t, ch) // must terminate (channel closed by supersede)

	h.Finish(k1, "ok")
	h.Finish(k2, "ok")
	if len(h.Active()) != 0 {
		t.Fatalf("want 0 active after Finish, got %d", len(h.Active()))
	}
}

func TestHasLogAndRemove(t *testing.T) {
	h := New(t.TempDir())
	key := Key{Module: "runbook", ID: 7}
	if h.HasLog(key) {
		t.Fatal("no log should exist yet")
	}
	emit, _ := h.Start(key, Meta{}, func() {})
	emit("x", nil)
	h.Finish(key, "ok")
	if !h.HasLog(key) {
		t.Fatal("log should exist after a run")
	}
	if err := h.Remove(key); err != nil {
		t.Fatal(err)
	}
	if h.HasLog(key) {
		t.Fatal("log should be gone after Remove")
	}
	if err := h.Remove(key); err != nil {
		t.Fatalf("Remove on a missing log should be a no-op, got %v", err)
	}
}
