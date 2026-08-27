//go:build !windows

package cmdtool

import "os/exec"

func hideConsole(*exec.Cmd) {}
