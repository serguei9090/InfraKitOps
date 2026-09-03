package main

import (
	"flag"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/infrakit/backend/internal/vault"
)

func TestApplyEnv(t *testing.T) {
	// A fresh FlagSet so flag.Visit sees only what this test "passes".
	fs := flag.NewFlagSet("t", flag.ContinueOnError)
	old := flag.CommandLine
	flag.CommandLine = fs
	t.Cleanup(func() { flag.CommandLine = old })

	addr := fs.String("addr", "127.0.0.1:0", "")
	auth := fs.String("auth", "off", "")
	dataDir := fs.String("data-dir", "", "")
	if err := fs.Parse([]string{"--addr", "0.0.0.0:9999"}); err != nil {
		t.Fatal(err)
	}

	t.Setenv("INFRAKIT_ADDR", "1.2.3.4:1") // must NOT override an explicit flag
	t.Setenv("INFRAKIT_AUTH", "on")        // fills the default
	t.Setenv("INFRAKIT_DATA_DIR", "/data") // fills the default

	applyEnv(map[string]*string{"addr": addr, "auth": auth, "data-dir": dataDir})

	if *addr != "0.0.0.0:9999" {
		t.Errorf("addr = %q, want the explicit flag to win", *addr)
	}
	if *auth != "on" {
		t.Errorf("auth = %q, want env fill", *auth)
	}
	if *dataDir != "/data" {
		t.Errorf("data-dir = %q, want env fill", *dataDir)
	}
}

func TestEnvTruthy(t *testing.T) {
	for _, v := range []string{"1", "true", "TRUE", "yes", "on"} {
		t.Setenv("X", v)
		if !envTruthy("X") {
			t.Errorf("envTruthy(%q) = false", v)
		}
	}
	for _, v := range []string{"", "0", "false", "no", "off", "maybe"} {
		t.Setenv("X", v)
		if envTruthy("X") {
			t.Errorf("envTruthy(%q) = true", v)
		}
	}
}

func TestUnlockVaultFromFile(t *testing.T) {
	dir := t.TempDir()
	pwFile := filepath.Join(dir, "pw")
	if err := os.WriteFile(pwFile, []byte("super-secret-pass\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	// Fresh vault → initialised + unlocked.
	reg := vault.NewRegistry(filepath.Join(dir, "vault.enc"), time.Minute)
	unlockVaultFromFile(reg, pwFile)
	if st := reg.For("").Status(); !st.Initialised || !st.Unlocked {
		t.Fatalf("after init: %+v", st)
	}

	// A new registry over the same file, locked → unlocked from the file.
	reg2 := vault.NewRegistry(filepath.Join(dir, "vault.enc"), time.Minute)
	if reg2.For("").Status().Unlocked {
		t.Fatal("expected the reopened vault to start locked")
	}
	unlockVaultFromFile(reg2, pwFile)
	if !reg2.For("").Status().Unlocked {
		t.Fatal("passphrase file did not unlock the existing vault")
	}
}
