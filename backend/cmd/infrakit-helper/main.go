// Command infrakit-helper performs one privileged file operation and exits.
// It is spawned elevated (UAC "runas" on Windows, pkexec on Linux) by the
// backend only when a direct write hits a permission error. It reads a JSON
// request from the file named in argv[1], acts, writes a JSON result to
// argv[2], and deletes the request file. See NETWORK_MODULE_PLAN.md §2.4.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type request struct {
	Op      string `json:"op"`      // "hosts-write" | "hosts-restore"
	Path    string `json:"path"`    // target file (must be the OS hosts file)
	Content string `json:"content"` // new content for hosts-write
}

type response struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: infrakit-helper <request.json> <response.json>")
		os.Exit(2)
	}
	reqPath, respPath := os.Args[1], os.Args[2]

	raw, err := os.ReadFile(reqPath)
	_ = os.Remove(reqPath)
	if err != nil {
		writeResp(respPath, response{Error: "read request: " + err.Error()})
		return
	}
	var req request
	if err := json.Unmarshal(raw, &req); err != nil {
		writeResp(respPath, response{Error: "bad request: " + err.Error()})
		return
	}

	if !isAllowedPath(req.Path) {
		writeResp(respPath, response{Error: "path not allowed: " + req.Path})
		return
	}

	switch req.Op {
	case "hosts-write":
		err = atomicWriteWithBackup(req.Path, []byte(req.Content))
	case "hosts-restore":
		err = restoreLatestBackup(req.Path)
	default:
		err = fmt.Errorf("unknown op %q", req.Op)
	}
	if err != nil {
		writeResp(respPath, response{Error: err.Error()})
		return
	}
	writeResp(respPath, response{OK: true})
}

func writeResp(path string, r response) {
	b, _ := json.Marshal(r)
	_ = os.WriteFile(path, b, 0o600)
	if !r.OK {
		os.Exit(1)
	}
}

// isAllowedPath restricts writes to the platform hosts file only.
func isAllowedPath(p string) bool {
	want := hostsPath()
	return strings.EqualFold(filepath.Clean(p), filepath.Clean(want))
}

func hostsPath() string {
	if runtime.GOOS == "windows" {
		root := os.Getenv("SystemRoot")
		if root == "" {
			root = `C:\Windows`
		}
		return filepath.Join(root, "System32", "drivers", "etc", "hosts")
	}
	return "/etc/hosts"
}

func atomicWriteWithBackup(path string, content []byte) error {
	cur, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	backup := filepath.Join(dir, "hosts.infrakit-backup-"+time.Now().Format("20060102-150405"))
	if err := os.WriteFile(backup, cur, 0o644); err != nil {
		return fmt.Errorf("backup: %w", err)
	}
	tmp := filepath.Join(dir, ".hosts.infrakit-helper-tmp")
	if err := os.WriteFile(tmp, content, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func restoreLatestBackup(path string) error {
	dir := filepath.Dir(path)
	matches, err := filepath.Glob(filepath.Join(dir, "hosts.infrakit-backup-*"))
	if err != nil || len(matches) == 0 {
		return fmt.Errorf("no backup to restore")
	}
	newest := matches[0]
	for _, m := range matches {
		if m > newest {
			newest = m
		}
	}
	data, err := os.ReadFile(newest)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}
