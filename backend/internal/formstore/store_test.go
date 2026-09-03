package formstore

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func newStore(t *testing.T) *Store {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "f.db"))
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

func blob(name string) json.RawMessage { return json.RawMessage(`{"name":"` + name + `","fields":[]}`) }

func TestFormShareLifecycle(t *testing.T) {
	s := newStore(t)
	if err := s.Save("alice", "f1", "nginx", blob("nginx")); err != nil {
		t.Fatal(err)
	}

	// bob: nothing.
	if l, _ := s.List("bob"); len(l) != 0 {
		t.Fatalf("bob list = %d", len(l))
	}
	if _, err := s.Get("bob", "f1"); err != ErrNotFound {
		t.Fatalf("bob get = %v", err)
	}
	if s.Save("bob", "f1", "nginx", blob("x")) != ErrForbidden {
		t.Fatal("bob save should be forbidden")
	}

	// view grant.
	if err := s.Grant("f1", "bob", "alice", false); err != nil {
		t.Fatal(err)
	}
	l, _ := s.List("bob")
	if len(l) != 1 || !l[0].Shared || l[0].CanEdit {
		t.Fatalf("bob list after view grant: %+v", l)
	}
	if _, err := s.Get("bob", "f1"); err != nil {
		t.Fatalf("bob get after share: %v", err)
	}
	if s.Save("bob", "f1", "nginx", blob("x")) != ErrForbidden {
		t.Fatal("view grant must not allow save")
	}

	// edit grant.
	_ = s.Grant("f1", "bob", "alice", true)
	if !s.CanEdit("f1", "bob") {
		t.Fatal("edit grant")
	}
	if err := s.Save("bob", "f1", "nginx", blob("edited")); err != nil {
		t.Fatalf("bob edit-grant save: %v", err)
	}

	// published → carol sees it read-only.
	_ = s.SetPublished("alice", "f1", true)
	cl, _ := s.List("carol")
	if len(cl) != 1 || cl[0].CanEdit {
		t.Fatalf("carol published list: %+v", cl)
	}

	// reassign.
	if err := s.SetOwner("f1", "carol"); err != nil {
		t.Fatal(err)
	}
	if s.Owner("f1") != "carol" {
		t.Fatal("owner")
	}

	// delete-cascade.
	if err := s.Delete("carol", "f1"); err != nil {
		t.Fatal(err)
	}
	if gs, _ := s.Shares("f1"); len(gs) != 0 {
		t.Fatalf("shares survived delete: %+v", gs)
	}
}

func TestFormNewIsCreatable(t *testing.T) {
	s := newStore(t)
	// A fresh id — CanEdit is true for anyone (creation), Save owns it.
	if !s.CanEdit("brand-new", "dave") {
		t.Fatal("new id should be creatable")
	}
	if err := s.Save("dave", "brand-new", "thing", blob("thing")); err != nil {
		t.Fatal(err)
	}
	if s.Owner("brand-new") != "dave" {
		t.Fatal("dave should own what he created")
	}
}
