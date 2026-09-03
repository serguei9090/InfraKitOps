package promptstore

import "testing"

func TestPromptShare(t *testing.T) {
	s := newTestStore(t)
	if err := s.SavePrompt("alice", "p1", p("p1")); err != nil {
		t.Fatal(err)
	}

	// bob sees nothing.
	_, prompts, _ := s.Library("bob")
	if len(prompts) != 0 {
		t.Fatalf("bob library = %d, want 0", len(prompts))
	}
	if s.CanEditPrompt("p1", "bob") {
		t.Fatal("bob can't edit")
	}
	if err := s.SavePrompt("bob", "p1", p("p1")); err == nil {
		t.Fatal("bob save should be forbidden")
	}

	// view grant → bob sees it, still can't edit.
	if err := s.Grant("p1", "bob", "alice", false); err != nil {
		t.Fatal(err)
	}
	_, prompts, _ = s.Library("bob")
	if len(prompts) != 1 {
		t.Fatalf("bob library after share = %d, want 1", len(prompts))
	}
	if s.CanEditPrompt("p1", "bob") || s.SavePrompt("bob", "p1", p("p1")) == nil {
		t.Fatal("view grant must not allow edit")
	}

	// edit grant → bob can save.
	if err := s.Grant("p1", "bob", "alice", true); err != nil {
		t.Fatal(err)
	}
	if !s.CanEditPrompt("p1", "bob") {
		t.Fatal("edit grant")
	}
	if err := s.SavePrompt("bob", "p1", p("p1")); err != nil {
		t.Fatalf("bob edit-grant save: %v", err)
	}

	// reassign to carol.
	if err := s.SetOwner("p1", "carol"); err != nil {
		t.Fatal(err)
	}
	if s.PromptOwner("p1") != "carol" {
		t.Fatal("owner not changed")
	}

	// cascades
	if err := s.PurgeGranteeShares("bob"); err != nil {
		t.Fatal(err)
	}
	if v, _ := s.SharedAccess("p1", "bob"); v {
		t.Fatal("bob grant should be purged")
	}
	_ = s.Grant("p1", "dave", "carol", false)
	if err := s.DeletePrompt("carol", "p1"); err != nil {
		t.Fatal(err)
	}
	if gs, _ := s.Shares("p1"); len(gs) != 0 {
		t.Fatalf("shares survived delete: %+v", gs)
	}
}
