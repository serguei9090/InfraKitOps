package backup

import (
	"archive/tar"
	"compress/gzip"
	"database/sql"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func seedDB(t *testing.T, path string, rows int) {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE t (n INTEGER)`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < rows; i++ {
		if _, err := db.Exec(`INSERT INTO t (n) VALUES (?)`, i); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSnapshotAndPrune(t *testing.T) {
	data := t.TempDir()
	out := t.TempDir()
	seedDB(t, filepath.Join(data, "history.db"), 5)
	seedDB(t, filepath.Join(data, "auth.db"), 3)
	if err := os.WriteFile(filepath.Join(data, "vault.enc"), []byte("blob"), 0o600); err != nil {
		t.Fatal(err)
	}

	arc, err := Snapshot(data, out, "1.0.0")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(arc, ".tgz") {
		t.Fatalf("archive name: %s", arc)
	}

	// Extract + check contents.
	got := extract(t, arc)
	for _, want := range []string{"history.db", "auth.db", "vault.enc", "manifest.json"} {
		if _, ok := got[want]; !ok {
			t.Fatalf("archive missing %s (has %v)", want, keys(got))
		}
	}
	if string(got["vault.enc"]) != "blob" {
		t.Fatalf("vault.enc content: %q", got["vault.enc"])
	}

	// The snapshot DB is a real, queryable copy.
	restored := filepath.Join(t.TempDir(), "history.db")
	if err := os.WriteFile(restored, got["history.db"], 0o644); err != nil {
		t.Fatal(err)
	}
	db, _ := sql.Open("sqlite", "file:"+restored+"?mode=ro")
	defer db.Close()
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM t`).Scan(&n); err != nil || n != 5 {
		t.Fatalf("restored rows = %d, err %v", n, err)
	}

	// Prune keeps the newest N.
	for i := 0; i < 4; i++ {
		if _, err := Snapshot(data, out, "1.0.0"); err != nil {
			t.Fatal(err)
		}
	}
	if err := Prune(out, 2); err != nil {
		t.Fatal(err)
	}
	left, _ := filepath.Glob(filepath.Join(out, archivePrefix+"*.tgz"))
	if len(left) != 2 {
		t.Fatalf("after prune: %d archives, want 2", len(left))
	}
}

func TestSnapshotEmpty(t *testing.T) {
	if _, err := Snapshot(t.TempDir(), t.TempDir(), "x"); err == nil {
		t.Fatal("expected an error for an empty data dir")
	}
}

func extract(t *testing.T, archive string) map[string][]byte {
	t.Helper()
	f, err := os.Open(archive)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	tr := tar.NewReader(gz)
	out := map[string][]byte{}
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(tr)
		out[h.Name] = b
	}
	return out
}

func keys(m map[string][]byte) []string {
	var k []string
	for x := range m {
		k = append(k, x)
	}
	return k
}
