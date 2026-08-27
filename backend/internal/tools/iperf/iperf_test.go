package iperf

import (
	"slices"
	"strings"
	"testing"
)

func TestBlockedFlag(t *testing.T) {
	blocked := []string{"-s", "--server", "-D", "--daemon", "-c", "--client", "-F", "--file", "--logfile", "--pidfile", "-J", "--json", "--logfile=/etc/x"}
	for _, f := range blocked {
		if !blockedFlag(f) {
			t.Errorf("expected %q to be blocked", f)
		}
	}
	allowed := []string{"--dscp", "AF11", "--get-server-output", "-4", "--fq-rate", "10M"}
	for _, f := range allowed {
		if blockedFlag(f) {
			t.Errorf("expected %q to be allowed", f)
		}
	}
}

func TestBuildArgs(t *testing.T) {
	args := buildArgs(Options{
		Host: "10.0.0.5", Port: 5202, Duration: 5,
		Bidir: true, Reverse: true, UDP: true,
		Parallel: 4, Omit: 2, MSS: 1400, Length: 1200, Window: 262144, Bitrate: "100M",
		ExtraArgs: []string{"--dscp", "AF11", "-J", "  ", "--server"},
	})
	joined := strings.Join(args, " ")

	for _, want := range []string{"-c 10.0.0.5", "-p 5202", "-t 5", "--bidir", "-u", "-P 4", "-O 2", "--set-mss 1400", "-l 1200", "-w 262144", "-b 100M", "--dscp AF11"} {
		if !strings.Contains(joined, want) {
			t.Errorf("args %q missing %q", joined, want)
		}
	}
	// Bidir wins over Reverse: no bare -R.
	if slices.Contains(args, "-R") {
		t.Errorf("did not expect -R when Bidir set: %v", args)
	}
	// Blocked extra args stripped.
	if strings.Count(joined, "--json") != 1 || slices.Contains(args, "-J") || slices.Contains(args, "--server") {
		t.Errorf("blocked extra args leaked: %v", args)
	}
}

func TestBuildArgsReverseWithoutBidir(t *testing.T) {
	args := buildArgs(Options{Host: "h", Reverse: true})
	if !slices.Contains(args, "-R") {
		t.Errorf("expected -R: %v", args)
	}
}
