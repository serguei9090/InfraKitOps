package promptstore

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "p.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	s, err := New(db)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func p(id string) json.RawMessage { return json.RawMessage(`{"id":"` + id + `","name":"` + id + `"}`) }

func TestPromptScoping(t *testing.T) {
	s := newTestStore(t)

	if err := s.SavePrompt("alice", "p1", p("p1")); err != nil {
		t.Fatal(err)
	}
	if err := s.SavePrompt("bob", "p2", p("p2")); err != nil {
		t.Fatal(err)
	}

	_, ap, _ := s.Library("alice")
	if len(ap) != 1 {
		t.Fatalf("alice sees %d prompts, want 1", len(ap))
	}
	_, bp, _ := s.Library("bob")
	if len(bp) != 1 {
		t.Fatalf("bob sees %d prompts, want 1", len(bp))
	}

	// bob cannot overwrite alice's prompt
	if err := s.SavePrompt("bob", "p1", p("p1")); err != ErrForbidden() {
		t.Fatalf("cross-user save: want ErrForbidden, got %v", err)
	}

	// publish makes p1 visible to bob
	if err := s.SetPublished("alice", "p1", true); err != nil {
		t.Fatal(err)
	}
	_, bp, _ = s.Library("bob")
	if len(bp) != 2 {
		t.Fatalf("after publish bob sees %d, want 2", len(bp))
	}

	// single-user ("") sees everything
	_, all, _ := s.Library("")
	if len(all) != 2 {
		t.Fatalf(`owner "" sees %d, want 2`, len(all))
	}

	if err := s.DeletePrompt("alice", "p1"); err != nil {
		t.Fatal(err)
	}
	if _, ap, _ = s.Library("alice"); len(ap) != 0 {
		t.Fatalf("alice still sees %d after delete", len(ap))
	}
}

func TestClaimOrphans(t *testing.T) {
	s := newTestStore(t)
	_ = s.SavePrompt("", "orphan", p("orphan"))
	if err := s.ClaimOrphans("admin"); err != nil {
		t.Fatal(err)
	}
	if s.promptOwner("orphan") != "admin" {
		t.Fatal("orphan not claimed")
	}
}
