package executor

import (
	"bytes"
	"context"
	"io"
	"os"
	"os/exec"
	"strings"
)

// pythonExecutor runs a Python script via `uv run` (R4). uv builds an ephemeral
// virtual environment per invocation — the requested interpreter version and
// every `--with` dependency are fetched/cached by uv, so the host needs no
// global Python and no venv management. The script is passed on stdin (`-`),
// never concatenated into a command line.
type pythonExecutor struct{}

// uvAvailable reports whether `uv` is on PATH — gates the python executor.
func uvAvailable() bool {
	_, err := exec.LookPath("uv")
	return err == nil
}

func (pythonExecutor) Run(ctx context.Context, step Step, stdout, stderr io.Writer) Result {
	args := []string{"run", "--no-project", "--quiet"}
	if step.Python != nil {
		if v := strings.TrimSpace(step.Python.Version); v != "" {
			args = append(args, "--python", v)
		}
		for _, d := range step.Python.Deps {
			if d = strings.TrimSpace(d); d != "" {
				args = append(args, "--with", d)
			}
		}
	}
	args = append(args, "-") // read the script from stdin

	cmd := exec.CommandContext(ctx, "uv", args...)
	cmd.Stdin = bytes.NewReader([]byte(step.Script))

	env := os.Environ()
	for k, v := range step.Env {
		env = append(env, k+"="+v)
	}
	cmd.Env = env

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
