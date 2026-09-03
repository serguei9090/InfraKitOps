package orchestrator

import "testing"

func mkRB(t *testing.T, s *Store, owner string) string {
	t.Helper()
	rb, err := s.CreateRunbook(owner, Spec{Name: "x", DefaultTimeoutSec: 10})
	if err != nil {
		t.Fatal(err)
	}
	return rb.ID
}

func TestRunbookShareAccess(t *testing.T) {
	s := newStore(t)
	id := mkRB(t, s, "alice")

	// Baseline: only alice.
	if s.CanView(id, "bob") || s.CanEdit(id, "bob") {
		t.Fatal("bob should have nothing")
	}
	if !s.CanView(id, "alice") || !s.CanEdit(id, "alice") {
		t.Fatal("alice is the owner")
	}

	// View grant.
	if err := s.Grant(id, "bob", "alice", false); err != nil {
		t.Fatal(err)
	}
	if !s.CanView(id, "bob") {
		t.Fatal("bob should now view")
	}
	if s.CanEdit(id, "bob") {
		t.Fatal("view grant is not edit")
	}
	if got := s.ListRunbooksMust(t, "bob"); len(got) != 1 {
		t.Fatalf("bob's list = %d, want 1 (shared)", len(got))
	}

	// Upgrade to edit.
	if err := s.Grant(id, "bob", "alice", true); err != nil {
		t.Fatal(err)
	}
	if !s.CanEdit(id, "bob") {
		t.Fatal("bob should now edit")
	}

	// Carol still sees nothing.
	if len(s.ListRunbooksMust(t, "carol")) != 0 {
		t.Fatal("carol should see no runbooks")
	}

	// Revoke.
	if err := s.Revoke(id, "bob"); err != nil {
		t.Fatal(err)
	}
	if s.CanView(id, "bob") {
		t.Fatal("revoked")
	}
}

func TestRunbookReassignAndCascades(t *testing.T) {
	s := newStore(t)
	id := mkRB(t, s, "alice")
	_ = s.Grant(id, "bob", "alice", true)

	// Reassign to carol — carol now owns + edits, alice loses the owner path.
	if err := s.SetOwner(id, "carol"); err != nil {
		t.Fatal(err)
	}
	if !s.CanEdit(id, "carol") {
		t.Fatal("carol should own it")
	}
	if s.CanView(id, "alice") {
		t.Fatal("alice no longer owns it and has no grant")
	}
	if !s.CanEdit(id, "bob") {
		t.Fatal("bob's grant survives a reassign")
	}
	if err := s.SetOwner("nope", "x"); err != ErrNotFound {
		t.Fatalf("reassign missing: %v", err)
	}

	// User-delete cascade.
	if err := s.PurgeGranteeShares("bob"); err != nil {
		t.Fatal(err)
	}
	if s.CanView(id, "bob") {
		t.Fatal("bob's grants should be purged")
	}

	// Runbook-delete cascade.
	_ = s.Grant(id, "dave", "carol", false)
	if err := s.DeleteRunbook(id); err != nil {
		t.Fatal(err)
	}
	if gs, _ := s.Shares(id); len(gs) != 0 {
		t.Fatalf("shares survived runbook delete: %+v", gs)
	}
}

// ListRunbooksMust is a test convenience.
func (s *Store) ListRunbooksMust(t *testing.T, viewer string) []*Runbook {
	t.Helper()
	l, err := s.ListRunbooks(viewer)
	if err != nil {
		t.Fatal(err)
	}
	return l
}
