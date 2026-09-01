package vault

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/infrakit/backend/internal/userctx"
)

func TestRegistryPerUserIsolation(t *testing.T) {
	dir := t.TempDir()
	reg := NewRegistry(filepath.Join(dir, "vault.enc"), time.Minute)

	shared := reg.For("")
	alice := reg.For("usr_alice")
	bob := reg.For("usr_bob")

	if shared == alice || alice == bob {
		t.Fatal("registry handed out the same *Vault for different users")
	}
	// same key → same instance
	if reg.For("usr_alice") != alice {
		t.Fatal("registry did not cache the per-user vault")
	}

	for _, v := range []*Vault{shared, alice, bob} {
		if err := v.Init("a-strong-master-pw"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := alice.Put("", "TOKEN", KindToken, "", "alice-secret"); err != nil {
		t.Fatal(err)
	}

	// alice's secret is invisible to bob and to the shared vault
	if len(bob.List()) != 0 || len(shared.List()) != 0 {
		t.Fatal("secret leaked across per-user vaults")
	}
	if len(alice.List()) != 1 {
		t.Fatalf("alice lost her secret: %d", len(alice.List()))
	}

	// the ctx resolver routes to the right vault
	rr := reg.Resolver()
	got, err := rr.ResolveByName(userctx.With(context.Background(), "usr_alice"), "TOKEN")
	if err != nil || got != "alice-secret" {
		t.Fatalf("resolver: %q %v", got, err)
	}
	if _, err := rr.ResolveByName(userctx.With(context.Background(), "usr_bob"), "TOKEN"); err == nil {
		t.Fatal("resolver returned alice's secret to bob")
	}
}
