//go:build windows

package cmdtool

import (
	"os/exec"
	"syscall"
)

// hideConsole stops a brief console window from flashing when the backend runs
// as a GUI sidecar.
func HideConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
