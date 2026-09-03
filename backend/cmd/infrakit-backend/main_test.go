package main

import (
	"flag"
	"testing"
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
