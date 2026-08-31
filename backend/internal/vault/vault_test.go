package vault

import (
	"path/filepath"
	"testing"
	"time"
)

func newVault(t *testing.T) *Vault {
	t.Helper()
	v, err := Open(filepath.Join(t.TempDir(), "vault.enc"), 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestInitUnlockLock(t *testing.T) {
	v := newVault(t)
	if v.Status().Initialised {
		t.Fatal("fresh vault should not be initialised")
	}
	if err := v.Init("hunter2!"); err != nil {
		t.Fatalf("init: %v", err)
	}
	if !v.Status().Unlocked {
		t.Fatal("vault should be unlocked right after init")
	}
	if err := v.Init("again123"); err != ErrExists {
		t.Fatalf("double init: want ErrExists, got %v", err)
	}

	v.Lock()
	if v.Status().Unlocked {
		t.Fatal("locked vault reports unlocked")
	}
	if err := v.Unlock("wrong-pass"); err != ErrBadPassword {
		t.Fatalf("bad unlock: want ErrBadPassword, got %v", err)
	}
	if err := v.Unlock("hunter2!"); err != nil {
		t.Fatalf("unlock: %v", err)
	}
}

func TestSecretRoundTripAndReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "vault.enc")
	v, _ := Open(path, time.Minute)
	if err := v.Init("masterpw1"); err != nil {
		t.Fatal(err)
	}
	id, err := v.Put("", "PROD_DB", KindPassword, "prod database", "s3cr3t-value")
	if err != nil {
		t.Fatalf("put: %v", err)
	}

	// Metadata visible while locked; value is not.
	v.Lock()
	list := v.List()
	if len(list) != 1 || list[0].Name != "PROD_DB" || list[0].Kind != KindPassword {
		t.Fatalf("list after lock: %+v", list)
	}
	if _, err := v.Resolve(id); err != ErrLocked {
		t.Fatalf("resolve while locked: want ErrLocked, got %v", err)
	}

	// Reopen from disk, unlock, resolve.
	v2, err := Open(path, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !v2.Status().Initialised {
		t.Fatal("reopened vault not initialised")
	}
	if err := v2.Unlock("masterpw1"); err != nil {
		t.Fatalf("reopen unlock: %v", err)
	}
	got, err := v2.Resolve(id)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if got != "s3cr3t-value" {
		t.Fatalf("value = %q", got)
	}
	if got, _ := v2.ResolveByName("PROD_DB"); got != "s3cr3t-value" {
		t.Fatalf("ResolveByName = %q", got)
	}
}

func TestAutoLock(t *testing.T) {
	v := newVault(t)
	_ = v.Init("masterpw1")
	v.SetAutoLock(20 * time.Millisecond)
	time.Sleep(40 * time.Millisecond)
	if v.Status().Unlocked {
		t.Fatal("vault should have auto-locked")
	}
}

func TestExportImport(t *testing.T) {
	v := newVault(t)
	_ = v.Init("masterpw1")
	id, _ := v.Put("", "TOK", KindToken, "", "abc123")

	blob, err := v.ExportBytes()
	if err != nil {
		t.Fatal(err)
	}

	dst := newVault(t)
	if err := dst.ImportBytes(blob, "wrong"); err != ErrBadPassword {
		t.Fatalf("import wrong pw: %v", err)
	}
	if err := dst.ImportBytes(blob, "masterpw1"); err != nil {
		t.Fatalf("import: %v", err)
	}
	_ = dst.Unlock("masterpw1")
	if got, _ := dst.Resolve(id); got != "abc123" {
		t.Fatalf("imported value = %q", got)
	}
}
