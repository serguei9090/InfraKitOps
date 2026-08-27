package history

import (
	"fmt"
	"testing"
	"time"

	"github.com/infrakit/backend/internal/envelope"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	// A unique shared-cache in-memory DB per test.
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())
	s, err := Open(dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func sampleEnvelope(tool, target string, started int64) envelope.Envelope {
	return envelope.Envelope{
		Tool:        tool,
		Target:      target,
		StartedAt:   started,
		FinishedAt:  started + 10,
		Status:      envelope.StatusOK,
		Params:      map[string]any{"type": "A"},
		ResultShape: envelope.ShapeText,
		Result:      map[string]any{"v": 1, "text": "hello"},
		Summary:     map[string]any{"answers": 2},
	}
}

func TestSaveAndGet(t *testing.T) {
	s := testStore(t)
	id, err := s.Save(sampleEnvelope("dns-lookup", "example.com", 1000), "test", PrunePolicy{})
	if err != nil {
		t.Fatal(err)
	}
	if id == 0 {
		t.Fatal("expected a row id")
	}

	run, err := s.Get(id)
	if err != nil || run == nil {
		t.Fatalf("Get: %v run=%v", err, run)
	}
	if run.Tool != "dns-lookup" || run.Target != "example.com" {
		t.Fatalf("unexpected run: %+v", run.RunSummary)
	}
	if run.Params["type"] != "A" {
		t.Fatalf("params not round-tripped: %+v", run.Params)
	}
	res, ok := run.Result.(map[string]any)
	if !ok || res["text"] != "hello" {
		t.Fatalf("result not round-tripped: %#v", run.Result)
	}
}

func TestGetMissingReturnsNil(t *testing.T) {
	s := testStore(t)
	run, err := s.Get(4242)
	if err != nil {
		t.Fatal(err)
	}
	if run != nil {
		t.Fatal("expected nil for a missing id")
	}
}

func TestListFiltersAndOrders(t *testing.T) {
	s := testStore(t)
	for i, tgt := range []string{"a.com", "a.com", "b.com"} {
		if _, err := s.Save(sampleEnvelope("dns-lookup", tgt, int64(1000+i)), "test", PrunePolicy{}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Save(sampleEnvelope("whois", "a.com", 5000), "test", PrunePolicy{}); err != nil {
		t.Fatal(err)
	}

	all, _ := s.List("", "", 0)
	if len(all) != 4 {
		t.Fatalf("List all = %d, want 4", len(all))
	}
	if all[0].StartedAt < all[1].StartedAt {
		t.Fatal("list not newest-first")
	}

	dnsA, _ := s.List("dns-lookup", "a.com", 0)
	if len(dnsA) != 2 {
		t.Fatalf("List(dns-lookup,a.com) = %d, want 2", len(dnsA))
	}
	if dnsA[0].Summary["answers"] != float64(2) {
		t.Fatalf("summary not decoded: %#v", dnsA[0].Summary)
	}
}

func TestPruneKeepsMaxPerTargetAndPinned(t *testing.T) {
	s := testStore(t)
	policy := PrunePolicy{MaxPerTarget: 3}
	var firstID int64
	for i := 0; i < 10; i++ {
		id, err := s.Save(sampleEnvelope("ping", "host", int64(1000+i)), "test", policy)
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			firstID = id
		}
	}
	// Only the 3 newest survive.
	got, _ := s.List("ping", "host", 0)
	if len(got) != 3 {
		t.Fatalf("after prune got %d, want 3", len(got))
	}

	// Pin the oldest, add more — the pinned one must persist.
	if _, err := s.Save(sampleEnvelope("ping", "host2", 1), "test", PrunePolicy{}); err != nil {
		t.Fatal(err)
	}
	_ = firstID // the first run was already pruned above; assert pin protects a live one instead
	live, _ := s.List("ping", "host", 1)
	if err := s.SetPinned(live[0].ID, true); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		if _, err := s.Save(sampleEnvelope("ping", "host", int64(9000+i)), "test", policy); err != nil {
			t.Fatal(err)
		}
	}
	after, _ := s.List("ping", "host", 0)
	foundPinned := false
	for _, r := range after {
		if r.ID == live[0].ID {
			foundPinned = true
		}
	}
	if !foundPinned {
		t.Fatal("pinned run was pruned")
	}
}

func TestPruneRetentionDays(t *testing.T) {
	s := testStore(t)
	old := time.Now().Add(-100 * 24 * time.Hour).UnixMilli()
	recent := time.Now().Add(-1 * time.Hour).UnixMilli()
	policy := PrunePolicy{RetentionDays: 30, MaxPerTarget: 1}

	if _, err := s.Save(sampleEnvelope("sntp", "pool.ntp.org", old), "test", PrunePolicy{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Save(sampleEnvelope("sntp", "pool.ntp.org", recent), "test", policy); err != nil {
		t.Fatal(err)
	}

	got, _ := s.List("sntp", "pool.ntp.org", 0)
	if len(got) != 1 || got[0].StartedAt != recent {
		t.Fatalf("retention prune wrong: %+v", got)
	}
}

func TestDeleteAndLabel(t *testing.T) {
	s := testStore(t)
	id, _ := s.Save(sampleEnvelope("whois", "x.com", 1), "test", PrunePolicy{})
	if err := s.SetLabel(id, "baseline"); err != nil {
		t.Fatal(err)
	}
	run, _ := s.Get(id)
	if run.Label != "baseline" {
		t.Fatalf("label = %q", run.Label)
	}
	if err := s.Delete(id); err != nil {
		t.Fatal(err)
	}
	run, _ = s.Get(id)
	if run != nil {
		t.Fatal("run still present after delete")
	}
}
