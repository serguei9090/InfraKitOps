//go:build !windows && !linux

package firewall

import "fmt"

func listImpl() (Result, error) {
	return Result{}, fmt.Errorf("firewall viewing is not supported on this platform yet")
}
