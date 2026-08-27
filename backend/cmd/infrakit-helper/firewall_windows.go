//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"syscall"

	"github.com/infrakit/backend/internal/fwspec"
)

// firewallExec re-validates the change and re-derives the netsh argument
// vector from fwspec (the same code the backend already ran), so the payload
// can only ever produce a well-formed `netsh advfirewall firewall …` call.
func firewallExec(payload string) error {
	var change fwspec.Change
	if err := json.Unmarshal([]byte(payload), &change); err != nil {
		return fmt.Errorf("bad firewall change: %w", err)
	}
	args, err := fwspec.NetshArgs(change)
	if err != nil {
		return err
	}
	cmd := exec.Command("netsh", args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("netsh: %s", msg)
	}
	return nil
}
