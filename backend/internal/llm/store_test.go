package llm

import (
	"path/filepath"
	"testing"
)

func newStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open("file:" + filepath.Join(t.TempDir(), "llm.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestConnectionCRUD(t *testing.T) {
	s := newStore(t)

	if _, err := s.PutConnection("", Connection{Name: "x", Provider: "bogus"}); err == nil {
		t.Fatal("expected unsupported-provider error")
	}
	if _, err := s.PutConnection("", Connection{Provider: ProviderOllama}); err == nil {
		t.Fatal("expected name-required error")
	}

	c, err := s.PutConnection("", Connection{Name: "Local", Provider: ProviderOllama, BaseURL: "http://localhost:11434"})
	if err != nil {
		t.Fatal(err)
	}
	if c.ID == "" || c.CreatedAt == 0 {
		t.Fatalf("id/createdAt not set: %+v", c)
	}

	// update keeps createdAt
	c.Name = "Local Ollama"
	c.CreatedAt = 0
	c2, err := s.PutConnection("", c)
	if err != nil {
		t.Fatal(err)
	}
	if c2.CreatedAt == 0 {
		t.Fatal("createdAt lost on update")
	}

	list, _ := s.ListConnections("")
	if len(list) != 1 || list[0].Name != "Local Ollama" {
		t.Fatalf("list = %+v", list)
	}

	got, err := s.GetConnection("", c.ID)
	if err != nil || got.Provider != ProviderOllama {
		t.Fatalf("get = %+v err %v", got, err)
	}

	if err := s.DeleteConnection("", c.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteConnection("", c.ID); err != ErrNotFound {
		t.Fatalf("double delete: want ErrNotFound, got %v", err)
	}
}

func TestSettings(t *testing.T) {
	s := newStore(t)
	_ = s.PutSetting("lastConn", "conn_abc")
	if s.GetSettings()["lastConn"] != "conn_abc" {
		t.Fatal("setting not round-tripped")
	}
}
