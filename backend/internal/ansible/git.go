package ansible

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// gitAvailable reports whether `git` is on PATH.
func gitAvailable() bool {
	_, err := exec.LookPath("git")
	return err == nil
}

// gitArgs prepends credential config for an https token, if given. For SSH
// URLs the caller's ssh-agent / keys are used (token ignored).
func gitAuthArgs(url, token string) []string {
	if token == "" || !strings.HasPrefix(url, "http") {
		return nil
	}
	// Bearer header — keeps the token out of the URL and the reflog.
	return []string{"-c", "http.extraHeader=Authorization: Bearer " + token}
}

// CloneRepo clones url@ref into dir. `token` is an optional https bearer token
// (already resolved from the Vault).
func CloneRepo(ctx context.Context, dir, url, ref, token string) error {
	if !gitAvailable() {
		return fmt.Errorf("git is not installed")
	}
	if entries, err := os.ReadDir(dir); err == nil && len(entries) > 0 {
		return fmt.Errorf("%s already exists and is not empty", dir)
	}
	args := append(gitAuthArgs(url, token), "clone", "--depth", "1")
	if strings.TrimSpace(ref) != "" {
		args = append(args, "--branch", ref)
	}
	args = append(args, url, dir)

	c, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(c, "git", args...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if out, err := cmd.CombinedOutput(); err != nil {
		_ = os.RemoveAll(dir)
		return fmt.Errorf("git clone: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// PullRepo fast-forwards dir to its upstream (git fetch + reset --hard @{u}).
func PullRepo(ctx context.Context, dir, url, ref, token string) (string, error) {
	if !gitAvailable() {
		return "", fmt.Errorf("git is not installed")
	}
	if _, err := os.Stat(dir + "/.git"); err != nil {
		return "", fmt.Errorf("not a git checkout")
	}
	c, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	auth := gitAuthArgs(url, token)

	run := func(extra ...string) (string, error) {
		args := append([]string{"-C", dir}, append(auth, extra...)...)
		cmd := exec.CommandContext(c, "git", args...)
		cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
		out, err := cmd.CombinedOutput()
		return strings.TrimSpace(string(out)), err
	}

	if out, err := run("fetch", "--depth", "1", "origin"); err != nil {
		return "", fmt.Errorf("git fetch: %s", out)
	}
	target := "origin/HEAD"
	if strings.TrimSpace(ref) != "" {
		target = "origin/" + ref
	}
	out, err := run("reset", "--hard", target)
	if err != nil {
		return "", fmt.Errorf("git reset: %s", out)
	}
	return out, nil
}
