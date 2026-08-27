// Package elevate spawns the infrakit-helper binary with a one-shot privilege
// escalation (UAC "runas" on Windows, pkexec on Linux) for the rare operations
// that need it. The GUI/sidecar itself is never elevated. See
// NETWORK_MODULE_PLAN.md §2.4.
package elevate

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Request is the payload handed to the helper.
type Request struct {
	Op      string `json:"op"`
	Path    string `json:"path"`
	Content string `json:"content"`
}

type helperResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

// ErrHelperMissing means the infrakit-helper binary could not be located.
var ErrHelperMissing = fmt.Errorf("elevated helper binary not found next to the backend")

// helperPath looks for the infrakit-helper binary alongside the running
// backend. It tries the bare name and the name that mirrors the backend's own
// basename (which may carry a target-triple suffix in the dev / sidecar layout).
func helperPath() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	ext := ""
	if runtime.GOOS == "windows" {
		ext = ".exe"
	}
	dir := filepath.Dir(exe)
	base := filepath.Base(exe) // e.g. infrakit-backend-x86_64-pc-windows-msvc.exe

	candidates := []string{
		filepath.Join(dir, "infrakit-helper"+ext),
		filepath.Join(dir, "binaries", "infrakit-helper"+ext),
	}
	// Only mirror the backend's own basename when it actually is the backend
	// binary (dev / sidecar layout with a target-triple suffix).
	if strings.Contains(base, "infrakit-backend") {
		candidates = append([]string{
			filepath.Join(dir, strings.Replace(base, "infrakit-backend", "infrakit-helper", 1)),
		}, candidates...)
	}
	for _, cand := range candidates {
		if _, err := os.Stat(cand); err == nil {
			return cand, nil
		}
	}
	return "", ErrHelperMissing
}

// Run executes one privileged request, prompting the user for elevation.
// Returns nil on success.
func Run(req Request) error {
	helper, err := helperPath()
	if err != nil {
		return err
	}

	tmpDir, err := os.MkdirTemp("", "infrakit-elev-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	reqFile := filepath.Join(tmpDir, "req.json")
	respFile := filepath.Join(tmpDir, "resp.json")
	payload, _ := json.Marshal(req)
	if err := os.WriteFile(reqFile, payload, 0o600); err != nil {
		return err
	}

	if err := runElevated(helper, reqFile, respFile); err != nil {
		return err
	}

	out, err := os.ReadFile(respFile)
	if err != nil {
		return fmt.Errorf("helper produced no response (user cancelled the prompt?)")
	}
	var resp helperResponse
	if err := json.Unmarshal(out, &resp); err != nil {
		return fmt.Errorf("bad helper response: %w", err)
	}
	if !resp.OK {
		return fmt.Errorf("helper: %s", resp.Error)
	}
	return nil
}
