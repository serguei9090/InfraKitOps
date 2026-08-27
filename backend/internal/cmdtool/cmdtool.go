// Package cmdtool is a thin exec-and-parse helper for the network tools that
// shell out to an OS built-in (PowerShell, ip, nft, netsh) or a bundled binary
// (iperf3). It is deliberately NOT a framework: each tool stays its own
// internal/tools/<tool> package and owns its typed result struct. See
// CLAUDE.md "How to implement a network tool".
package cmdtool

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

// Run executes bin with args and returns stdout. Never build a shell string —
// pass an arg slice so nothing is word-split or interpreted.
func Run(ctx context.Context, bin string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	hideConsole(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return stdout.Bytes(), fmt.Errorf("%s: %s", bin, msg)
	}
	return stdout.Bytes(), nil
}

// RunJSON runs bin+args and unmarshals stdout into out. `out` must be a pointer.
func RunJSON(ctx context.Context, out any, bin string, args ...string) error {
	raw, err := Run(ctx, bin, args...)
	if err != nil {
		return err
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return nil // some cmdlets print nothing for an empty result set
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("%s: parse output: %w", bin, err)
	}
	return nil
}

// PowerShellArray runs a PowerShell pipeline that ends in `| ConvertTo-Json`
// and unmarshals it into `outSlice` (a *[]T). It papers over Windows
// PowerShell 5.1 emitting a bare object (not `[…]`) for a single result and
// nothing for an empty one. The caller's script must NOT use `-AsArray`
// (PS 7+ only).
func PowerShellArray(ctx context.Context, outSlice any, pipeline string) error {
	raw, err := Run(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", pipeline)
	if err != nil {
		return err
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return nil
	}
	if raw[0] == '{' {
		raw = append(append([]byte{'['}, raw...), ']')
	}
	if err := json.Unmarshal(raw, outSlice); err != nil {
		return fmt.Errorf("powershell: parse output: %w", err)
	}
	return nil
}
