package monitor

import (
	"testing"
	"time"
)

func TestStatusBoardCRUDAndPublic(t *testing.T) {
	s := newStore(t)

	// two monitors, one tagged "public" and up, one untagged and down
	up, _ := s.Put("alice", Monitor{Name: "api", Kind: "fake", Target: "x", Enabled: true, Tags: "public"})
	_ = s.recordCheck(up.ID, Sample{T: time.Now().UnixMilli(), OK: true, Value: 12}, StatusUp, true)
	down, _ := s.Put("alice", Monitor{Name: "worker", Kind: "fake", Target: "y", Enabled: true})
	_ = s.recordCheck(down.ID, Sample{T: time.Now().UnixMilli(), OK: false}, StatusDown, true)
	_ = s.OpenIncident(down.ID, "alice", time.Now().UnixMilli(), "boom", false)

	board, err := s.PutBoard("alice", StatusBoard{Title: "Acme", Tags: "public", ShowIncidents: true})
	if err != nil {
		t.Fatal(err)
	}
	if board.Token == "" || board.ID == "" {
		t.Fatalf("board = %+v", board)
	}
	if _, err := s.getBoard("bob", board.ID); err != ErrNotFound {
		t.Errorf("cross-user getBoard = %v", err)
	}

	// public view is filtered to the tagged monitor only
	ps, err := s.PublicStatus(board.Token, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(ps.Components) != 1 || ps.Components[0].Name != "api" {
		t.Fatalf("components = %+v", ps.Components)
	}
	if !ps.OK {
		t.Fatalf("board should be OK (down monitor is filtered out): %+v", ps)
	}

	// widen to all monitors → the down one + its incident show up
	board.Tags = ""
	if _, err := s.PutBoard("alice", *board); err != nil {
		t.Fatal(err)
	}
	ps, _ = s.PublicStatus(board.Token, time.Now())
	if len(ps.Components) != 2 || ps.OK {
		t.Fatalf("wide board = %+v", ps)
	}
	if len(ps.Incidents) != 1 || ps.Incidents[0].Name != "worker" {
		t.Fatalf("incidents = %+v", ps.Incidents)
	}

	// rotate invalidates the old token
	old := board.Token
	rot, err := s.RotateBoardToken("alice", board.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rot.Token == old {
		t.Fatal("token not rotated")
	}
	if _, err := s.PublicStatus(old, time.Now()); err != ErrNotFound {
		t.Errorf("old token still resolves: %v", err)
	}

	if err := s.DeleteBoard("alice", board.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PublicStatus(rot.Token, time.Now()); err != ErrNotFound {
		t.Errorf("deleted board still resolves: %v", err)
	}
}
