package packages

import (
	"context"
	"testing"
)

func TestDetect(t *testing.T) {
	tools := Detect(context.Background(), []string{"definitely-not-a-real-tool-xyz"})
	byName := map[string]Tool{}
	for _, x := range tools {
		byName[x.Name] = x
	}
	// `git` should be present in this environment.
	if g, ok := byName["git"]; !ok || !g.Present {
		t.Fatalf("git not detected: %+v", g)
	}
	// The bogus one is missing; if a manager was found it gets an install cmd.
	m, ok := byName["definitely-not-a-real-tool-xyz"]
	if !ok || m.Present {
		t.Fatalf("bogus tool should be missing: %+v", m)
	}
}

func TestInstallCommand(t *testing.T) {
	if got := installCommand("winget", "uv"); got == "" || got[:6] != "winget" {
		t.Fatalf("winget uv: %q", got)
	}
	if got := installCommand("apt", "jq"); got == "" || got[:4] != "sudo" {
		t.Fatalf("apt jq: %q", got)
	}
	if got := installCommand("bogus", "x"); got != "" {
		t.Fatalf("unknown manager should yield empty: %q", got)
	}
}
