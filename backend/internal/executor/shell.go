package executor

import (
	"bytes"
	"context"
	"io"
	"os"
	"os/exec"
	"runtime"
)

// shellExecutor runs powershell / cmd / bash. The user's script is passed on
// stdin (powershell, bash) or written to a temp .bat (cmd) — never concatenated
// into a command line. Timeout comes from ctx.
type shellExecutor struct{}

func (shellExecutor) Run(ctx context.Context, step Step, stdout, stderr io.Writer) Result {
	var cmd *exec.Cmd
	var stdin string

	switch step.Kind {
	case KindPowerShell:
		exe := "powershell"
		if _, err := exec.LookPath("pwsh"); err == nil {
			exe = "pwsh"
		}
		cmd = exec.CommandContext(ctx, exe, "-NoProfile", "-NonInteractive", "-Command", "-")
		stdin = step.Script

	case KindCmd:
		f, err := os.CreateTemp("", "runbook-*.bat")
		if err != nil {
			return Result{ExitCode: -1, Err: err.Error()}
		}
		defer os.Remove(f.Name())
		if _, err := f.WriteString("@echo off\r\n" + step.Script); err != nil {
			_ = f.Close()
			return Result{ExitCode: -1, Err: err.Error()}
		}
		_ = f.Close()
		cmd = exec.CommandContext(ctx, "cmd", "/c", f.Name())

	case KindBash:
		shell := "bash"
		if _, err := exec.LookPath("bash"); err != nil {
			shell = "sh"
		}
		if runtime.GOOS == "windows" {
			// unlikely path, but keep it working if bash is on PATH
		}
		cmd = exec.CommandContext(ctx, shell, "-s")
		stdin = step.Script

	default:
		return Result{ExitCode: -1, Err: "unsupported shell kind: " + string(step.Kind)}
	}

	if len(step.Env) > 0 {
		env := os.Environ()
		for k, v := range step.Env {
			env = append(env, k+"="+v)
		}
		cmd.Env = env
	}
	if stdin != "" {
		cmd.Stdin = bytes.NewReader([]byte(stdin))
	}

	// Tee: caller gets the live stream, we also keep the full text for history.
	var outBuf, errBuf bytes.Buffer
	cmd.Stdout = io.MultiWriter(stdout, &outBuf)
	cmd.Stderr = io.MultiWriter(stderr, &errBuf)

	err := cmd.Run()
	res := Result{Stdout: outBuf.String(), Stderr: errBuf.String()}
	switch {
	case err == nil:
		res.ExitCode = 0
	case ctx.Err() == context.DeadlineExceeded:
		res.ExitCode = -1
		res.Err = "timed out"
	case ctx.Err() == context.Canceled:
		res.ExitCode = -1
		res.Err = "cancelled"
	default:
		if ee, ok := err.(*exec.ExitError); ok {
			res.ExitCode = ee.ExitCode()
		} else {
			res.ExitCode = -1
			res.Err = err.Error()
		}
	}
	return res
}
