package sharedb

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	if err := EnsureSchema(db, "runbook_share", "runbook_id"); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestGrantRevokeAccess(t *testing.T) {
	db := openDB(t)
	const tbl, col = "runbook_share", "runbook_id"

	// nobody yet
	if v, e := Access(db, tbl, col, "rb1", "bob"); v || e {
		t.Fatal("expected no access")
	}
	// blank viewer never has share access
	if v, _ := Access(db, tbl, col, "rb1", ""); v {
		t.Fatal("blank viewer")
	}

	if err := Set(db, tbl, col, "rb1", "bob", "alice", false); err != nil {
		t.Fatal(err)
	}
	if v, e := Access(db, tbl, col, "rb1", "bob"); !v || e {
		t.Fatalf("view-only grant: v=%v e=%v", v, e)
	}
	// upgrade to edit
	if err := Set(db, tbl, col, "rb1", "bob", "alice", true); err != nil {
		t.Fatal(err)
	}
	if v, e := Access(db, tbl, col, "rb1", "bob"); !v || !e {
		t.Fatalf("edit grant: v=%v e=%v", v, e)
	}

	gs, _ := List(db, tbl, col, "rb1")
	if len(gs) != 1 || gs[0].GranteeID != "bob" || !gs[0].CanEdit || gs[0].GrantedBy != "alice" {
		t.Fatalf("List: %+v", gs)
	}

	if err := Revoke(db, tbl, col, "rb1", "bob"); err != nil {
		t.Fatal(err)
	}
	if v, _ := Access(db, tbl, col, "rb1", "bob"); v {
		t.Fatal("still has access after revoke")
	}
}

func TestCascades(t *testing.T) {
	db := openDB(t)
	const tbl, col = "runbook_share", "runbook_id"
	_ = Set(db, tbl, col, "rb1", "bob", "alice", false)
	_ = Set(db, tbl, col, "rb1", "carol", "alice", true)
	_ = Set(db, tbl, col, "rb2", "bob", "alice", false)

	if err := DeleteForThing(db, tbl, col, "rb1"); err != nil {
		t.Fatal(err)
	}
	if gs, _ := List(db, tbl, col, "rb1"); len(gs) != 0 {
		t.Fatalf("rb1 grants survived: %+v", gs)
	}
	if v, _ := Access(db, tbl, col, "rb2", "bob"); !v {
		t.Fatal("rb2 grant should be untouched")
	}

	_ = Set(db, tbl, col, "rb1", "bob", "alice", false)
	_ = Set(db, tbl, col, "rb1", "carol", "alice", true)
	if err := DeleteForGrantee(db, tbl, "bob"); err != nil {
		t.Fatal(err)
	}
	if v, _ := Access(db, tbl, col, "rb1", "bob"); v {
		t.Fatal("bob's grants should be gone")
	}
	if v, _ := Access(db, tbl, col, "rb1", "carol"); !v {
		t.Fatal("carol's grant should remain")
	}
}

func TestBadTable(t *testing.T) {
	db := openDB(t)
	if err := EnsureSchema(db, "runbook; DROP TABLE x", "id"); err == nil {
		t.Fatal("expected rejection of a bad table name")
	}
	if err := Set(db, "not_a_share_table", "id", "a", "b", "c", false); err == nil {
		t.Fatal("expected rejection")
	}
}
