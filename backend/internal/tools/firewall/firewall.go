// Package firewall reads the OS firewall rule set (read-only). Windows via
// `netsh advfirewall`, Linux via firewalld / ufw / nftables — whichever is
// active. Write CRUD is a separate, later release (see NETWORK_MODULE_PLAN.md
// §1.2 and tool #15).
package firewall

// Rule is one firewall rule, normalized across backends.
type Rule struct {
	Name            string `json:"name"`
	Enabled         bool   `json:"enabled"`
	Direction       string `json:"direction"` // inbound | outbound
	Action          string `json:"action"`    // allow | block
	Protocol        string `json:"protocol,omitempty"`
	LocalPorts      string `json:"localPorts,omitempty"`
	RemotePorts     string `json:"remotePorts,omitempty"`
	LocalAddresses  string `json:"localAddresses,omitempty"`
	RemoteAddresses string `json:"remoteAddresses,omitempty"`
	Profiles        string `json:"profiles,omitempty"`
	Program         string `json:"program,omitempty"`
	Grouping        string `json:"grouping,omitempty"`
	Description     string `json:"description,omitempty"`
}

// Result — shape "table".
type Result struct {
	V       int    `json:"v"`
	Backend string `json:"backend"` // "windows-firewall" | "firewalld" | "ufw" | "nftables"
	Rules   []Rule `json:"rules"`
	// Note is a non-fatal caveat for the UI (e.g. "some rules need elevation to enumerate").
	Note string `json:"note,omitempty"`
}

// List returns the current rule set.
func List() (Result, error) {
	return listImpl()
}
