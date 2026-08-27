//go:build windows

package server

import "os"

// On Windows os.FindProcess returns an error for a PID that no longer exists,
// so if we hold a *os.Process handle at all the process was alive at lookup
// time. Re-find to get a fresh answer.
func signalZero(p *os.Process) bool {
	fresh, err := os.FindProcess(p.Pid)
	if err != nil {
		return false
	}
	_ = fresh.Release()
	return true
}
