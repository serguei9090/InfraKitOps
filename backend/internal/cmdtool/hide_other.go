//go:build !windows

package cmdtool

import "os/exec"

func HideConsole(*exec.Cmd) {}
