// Package privilege reports whether the backend process is running with the
// elevated rights that raw-socket tools (SYN scan, ARP discovery, LLDP capture,
// MTU set) require. The frontend uses this to gray out the relevant tools —
// see NETWORK_MODULE_PLAN.md §2.2.
package privilege

// IsElevated returns true when the process can perform privileged network
// operations: root on Unix, an elevated token on Windows.
func IsElevated() bool {
	return isElevated()
}
