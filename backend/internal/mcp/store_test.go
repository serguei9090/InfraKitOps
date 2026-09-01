package mcp

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func newStore(t *testing.T) *Store {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "llm.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	s, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestServerCRUD(t *testing.T) {
	s := newStore(t)

	if _, err := s.Put("", ServerConfig{Transport: TransportStdio, Command: "x"}); err == nil {
		t.Fatal("expected name-required error")
	}
	if _, err := s.Put("", ServerConfig{Name: "x", Transport: TransportStdio}); err == nil {
		t.Fatal("expected command-required error")
	}
	if _, err := s.Put("", ServerConfig{Name: "x", Transport: TransportHTTP}); err == nil {
		t.Fatal("expected url-required error")
	}
	if _, err := s.Put("", ServerConfig{Name: "x", Transport: "carrier-pigeon"}); err == nil {
		t.Fatal("expected bad-transport error")
	}

	id, err := s.Put("", ServerConfig{
		Name: "Context7", Transport: TransportStdio,
		Command: "npx", Args: []string{"-y", "@upstash/context7-mcp"},
		Env: map[string]string{"KEY": "{{secret:CTX7}}"}, Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	got, err := s.Get("", id)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Context7" || got.CreatedAt == 0 || len(got.Args) != 2 {
		t.Fatalf("round-trip mismatch: %+v", got)
	}

	// update keeps createdAt
	got.Name = "ctx7"
	got.CreatedAt = 0
	if _, err := s.Put("", *got); err != nil {
		t.Fatal(err)
	}
	again, _ := s.Get("", id)
	if again.Name != "ctx7" || again.CreatedAt != got.CreatedAt && again.CreatedAt == 0 {
		t.Fatalf("update lost fields: %+v", again)
	}

	list, err := s.List("")
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v %d", err, len(list))
	}

	if err := s.Delete("", id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get("", id); err != ErrNotFound {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	if err := s.Delete("", id); err != ErrNotFound {
		t.Fatalf("delete missing: want ErrNotFound, got %v", err)
	}
}

func TestAllowlist(t *testing.T) {
	c := ServerConfig{}
	if !c.allowed("anything") {
		t.Fatal("empty allowlist should allow all")
	}
	c.ToolAllow = []string{"search", "fetch"}
	if !c.allowed("search") || c.allowed("delete") {
		t.Fatal("allowlist not enforced")
	}
}
