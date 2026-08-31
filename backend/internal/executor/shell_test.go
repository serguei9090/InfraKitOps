package executor

import (
	"context"
	"io"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"
)

func run(t *testing.T, step Step, timeout time.Duration) Result {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ex := For(step.Kind)
	if ex == nil {
		t.Skipf("executor %s not available on %s", step.Kind, runtime.GOOS)
	}
	return ex.Run(ctx, step, io.Discard, io.Discard)
}

func TestShellEcho(t *testing.T) {
	kind := KindBash
	script := "echo hello-runbook"
	if runtime.GOOS == "windows" {
		if _, err := lookBash(); err != nil {
			kind, script = KindPowerShell, "Write-Output 'hello-runbook'"
		}
	}
	res := run(t, Step{Kind: kind, Script: script}, 5*time.Second)
	if res.ExitCode != 0 {
		t.Fatalf("exit %d err %q", res.ExitCode, res.Err)
	}
	if !strings.Contains(res.Stdout, "hello-runbook") {
		t.Fatalf("stdout = %q", res.Stdout)
	}
}

func TestShellNonZeroExit(t *testing.T) {
	kind, script := KindBash, "exit 3"
	if runtime.GOOS == "windows" {
		if _, err := lookBash(); err != nil {
			kind, script = KindCmd, "exit /b 3"
		}
	}
	res := run(t, Step{Kind: kind, Script: script}, 5*time.Second)
	if res.ExitCode != 3 {
		t.Fatalf("exit = %d (err %q)", res.ExitCode, res.Err)
	}
}

func TestShellTimeout(t *testing.T) {
	kind, script := KindBash, "sleep 5"
	if runtime.GOOS == "windows" {
		if _, err := lookBash(); err != nil {
			kind, script = KindPowerShell, "Start-Sleep -Seconds 5"
		}
	}
	res := run(t, Step{Kind: kind, Script: script}, 300*time.Millisecond)
	if res.Err != "timed out" {
		t.Fatalf("want timed out, got exit %d err %q", res.ExitCode, res.Err)
	}
}

func TestShellEnv(t *testing.T) {
	kind, script := KindBash, "echo $RB_TEST"
	if runtime.GOOS == "windows" {
		if _, err := lookBash(); err != nil {
			kind, script = KindPowerShell, "Write-Output $env:RB_TEST"
		}
	}
	res := run(t, Step{Kind: kind, Script: script, Env: map[string]string{"RB_TEST": "injected"}}, 5*time.Second)
	if !strings.Contains(res.Stdout, "injected") {
		t.Fatalf("stdout = %q", res.Stdout)
	}
}

func lookBash() (string, error) {
	return exec.LookPath("bash")
}
