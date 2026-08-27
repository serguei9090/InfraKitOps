package elevate

import (
	"errors"
	"testing"
)

func TestHelperPathMissing(t *testing.T) {
	// The test binary's directory has no infrakit-helper, so resolution must
	// fail with ErrHelperMissing — never spawn anything.
	_, err := helperPath()
	if !errors.Is(err, ErrHelperMissing) {
		t.Fatalf("got %v, want ErrHelperMissing", err)
	}
}

func TestRunReturnsHelperMissing(t *testing.T) {
	if _, err := helperPath(); !errors.Is(err, ErrHelperMissing) {
		t.Skip("an infrakit-helper binary is present next to the test — skipping to avoid a real elevation prompt")
	}
	if err := Run(Request{Op: "hosts-write", Path: "/etc/hosts", Content: "x"}); !errors.Is(err, ErrHelperMissing) {
		t.Fatalf("got %v, want ErrHelperMissing", err)
	}
}
