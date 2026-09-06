package monitor

import (
	"context"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
)

func newStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "monitor.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// fakeProbe returns whatever ok/value the test sets, for a fixed kind.
type fakeProbe struct {
	ok    atomic.Bool
	value atomic.Int64
	calls atomic.Int64
}

func (f *fakeProbe) Kind() string { return "fake" }
func (f *fakeProbe) Probe(context.Context, Monitor) Sample {
	f.calls.Add(1)
	return Sample{OK: f.ok.Load(), Value: float64(f.value.Load())}
}

func withFakeProbe(t *testing.T) *fakeProbe {
	t.Helper()
	f := &fakeProbe{}
	f.ok.Store(true)
	prev := probes["fake"]
	register(f)
	t.Cleanup(func() {
		if prev != nil {
			probes["fake"] = prev
		} else {
			delete(probes, "fake")
		}
	})
	return f
}

func TestStoreCRUD(t *testing.T) {
	s := newStore(t)
	m, err := s.Put("alice", Monitor{Name: "gw", Kind: KindICMP, Target: "1.1.1.1", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if m.ID == "" || m.IntervalSec != defaultIntervalSec || m.Status != StatusUnknown {
		t.Fatalf("defaults not applied: %+v", m)
	}
	if _, err := s.Get("bob", m.ID); err != ErrNotFound {
		t.Errorf("cross-user Get = %v, want ErrNotFound", err)
	}
	// edit keeps id/owner/status
	m.Name = "gateway"
	m.IntervalSec = 3 // below min → clamped
	up, err := s.Put("alice", *m)
	if err != nil {
		t.Fatal(err)
	}
	if up.Name != "gateway" || up.IntervalSec != minIntervalSec || up.ID != m.ID {
		t.Fatalf("edit = %+v", up)
	}
	list, _ := s.List("alice")
	if len(list) != 1 {
		t.Fatalf("List = %d", len(list))
	}
	if _, err := s.SetEnabled("alice", m.ID, false); err != nil {
		t.Fatal(err)
	}
	paused, _ := s.Get("alice", m.ID)
	if paused.Enabled || paused.Status != StatusPaused {
		t.Fatalf("pause = %+v", paused)
	}
	if err := s.Delete("alice", m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get("alice", m.ID); err != ErrNotFound {
		t.Errorf("after delete Get = %v", err)
	}
}

func TestEngineStateMachine(t *testing.T) {
	f := withFakeProbe(t)
	s := newStore(t)
	e := NewEngine(s)

	var mu sync.Mutex
	var alerts []AlertEvent
	e.SetAlertSink(func(a AlertEvent) { mu.Lock(); alerts = append(alerts, a); mu.Unlock() })

	m, _ := s.Put("alice", Monitor{Name: "svc", Kind: "fake", Target: "x", Enabled: true, FailThreshold: 2, IntervalSec: 60, TimeoutSec: 5})

	// 1 ok  → up
	fails := 0
	e.tick(context.Background(), m.ID, &fails)
	if g, _ := s.Get("alice", m.ID); g.Status != StatusUp {
		t.Fatalf("after ok: %s", g.Status)
	}

	// 2 fails → down (threshold 2), one "down" alert
	f.ok.Store(false)
	e.tick(context.Background(), m.ID, &fails) // fail 1 — still up
	if g, _ := s.Get("alice", m.ID); g.Status != StatusUp {
		t.Fatalf("after 1 fail: %s (should hold up until threshold)", g.Status)
	}
	e.tick(context.Background(), m.ID, &fails) // fail 2 — down
	if g, _ := s.Get("alice", m.ID); g.Status != StatusDown {
		t.Fatalf("after 2 fails: %s", g.Status)
	}

	// recover
	f.ok.Store(true)
	e.tick(context.Background(), m.ID, &fails)
	if g, _ := s.Get("alice", m.ID); g.Status != StatusUp {
		t.Fatalf("after recover: %s", g.Status)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(alerts) != 2 || alerts[0].Event != "down" || alerts[1].Event != "recovered" {
		t.Fatalf("alerts = %+v", alerts)
	}

	samples, _ := s.Samples("alice", m.ID, 0, 100)
	if len(samples) != 4 {
		t.Fatalf("samples = %d, want 4", len(samples))
	}
}

func TestSeedFailStreak(t *testing.T) {
	s := newStore(t)
	m, _ := s.Put("alice", Monitor{Name: "x", Kind: "fake", Target: "x", Enabled: true, FailThreshold: 3})
	// ok, fail, fail
	_ = s.recordCheck(m.ID, Sample{T: 1, OK: true}, StatusUp, true)
	_ = s.recordCheck(m.ID, Sample{T: 2, OK: false}, StatusUp, false)
	_ = s.recordCheck(m.ID, Sample{T: 3, OK: false}, StatusUp, false)
	if n := seedFailStreak(s, m.ID, 3); n != 2 {
		t.Fatalf("seedFailStreak = %d, want 2", n)
	}
}

func TestPruneKeepsNewest(t *testing.T) {
	s := newStore(t)
	m, _ := s.Put("alice", Monitor{Name: "x", Kind: "fake", Target: "x", Enabled: true})
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for i := int64(1); i <= maxSamplesPerMonitor+50; i++ {
		if _, err := tx.Exec(`INSERT INTO monitor_sample (monitor_id, t, ok, value, detail) VALUES (?,?,1,0,'')`, m.ID, i); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := s.prune(); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Samples("alice", m.ID, 0, maxSamplesPerMonitor+100)
	if len(got) != maxSamplesPerMonitor {
		t.Fatalf("after prune: %d samples, want %d", len(got), maxSamplesPerMonitor)
	}
	if got[0].T != 51 {
		t.Fatalf("oldest kept sample T = %d, want 51", got[0].T)
	}
}
