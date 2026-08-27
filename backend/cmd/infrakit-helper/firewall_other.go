//go:build !windows

package main

import "fmt"

func firewallExec(_ string) error {
	return fmt.Errorf("firewall-exec is only supported on Windows")
}
