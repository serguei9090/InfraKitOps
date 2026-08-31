package executor

import (
	"strings"
	"testing"
	"time"
)

func TestPythonRun(t *testing.T) {
	if !uvAvailable() {
		t.Skip("uv not on PATH")
	}
	res := run(t, Step{
		Kind:   KindPython,
		Script: "print('hello-from-python')",
	}, 60*time.Second)
	if res.ExitCode != 0 {
		t.Fatalf("exit %d err %q stderr %q", res.ExitCode, res.Err, res.Stderr)
	}
	if !strings.Contains(res.Stdout, "hello-from-python") {
		t.Fatalf("stdout = %q", res.Stdout)
	}
}

func TestPythonNonZeroExit(t *testing.T) {
	if !uvAvailable() {
		t.Skip("uv not on PATH")
	}
	res := run(t, Step{
		Kind:   KindPython,
		Script: "import sys; sys.exit(4)",
	}, 60*time.Second)
	if res.ExitCode != 4 {
		t.Fatalf("exit = %d (err %q)", res.ExitCode, res.Err)
	}
}

func TestPythonUnavailableWithoutUv(t *testing.T) {
	if uvAvailable() {
		t.Skip("uv is installed — cannot test the missing-uv path")
	}
	if For(KindPython) != nil {
		t.Fatal("expected nil executor when uv is absent")
	}
	if AvailableKinds()[KindPython] {
		t.Fatal("expected python kind unavailable when uv is absent")
	}
}
