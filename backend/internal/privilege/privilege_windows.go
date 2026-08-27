//go:build windows

package privilege

import "os"

// isElevated uses the well-known heuristic of trying to open a raw physical
// drive handle, which only an elevated (Administrator) token is granted. This
// keeps the N0 skeleton dependency-free; a precise check via
// golang.org/x/sys/windows GetTokenInformation(TokenElevation) lands with the
// first tool that actually needs raw sockets (see NETWORK_MODULE_PLAN.md §2.2).
func isElevated() bool {
	f, err := os.Open(`\\.\PHYSICALDRIVE0`)
	if err != nil {
		return false
	}
	_ = f.Close()
	return true
}
