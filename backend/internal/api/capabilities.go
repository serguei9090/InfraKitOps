package api

import (
	"net/http"

	"github.com/infrakit/backend/internal/privilege"
)

// Capability describes whether one tool can run in the current environment.
// `Reason` is shown in the UI when Available is false.
type Capability struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
	// NeedsElevation is true for tools that would work if the backend were
	// run elevated — the UI shows a "run as administrator" hint rather than
	// a hard "unsupported".
	NeedsElevation bool `json:"needsElevation,omitempty"`
}

// Capabilities reports, per tool id, whether it is wired and runnable. During
// N0 no tools are implemented yet, so every entry is unavailable with a
// "not implemented" reason; each phase flips its tools on here as they land.
func Capabilities(w http.ResponseWriter, _ *http.Request) {
	elevated := privilege.IsElevated()

	notImpl := Capability{Available: false, Reason: "not implemented yet"}
	// Tools that additionally need raw sockets — surfaced now so the UI copy
	// is correct from the start.
	rawSocket := func() Capability {
		c := Capability{Available: false, Reason: "not implemented yet"}
		if !elevated {
			c.NeedsElevation = true
		}
		return c
	}

	caps := map[string]Capability{
		"subnet-calculator":  {Available: true}, // pure client, always available
		"dns-lookup":         {Available: true},
		"sntp":               {Available: true},
		"whois":              {Available: true},
		"ip-geolocation":     {Available: true},
		"connections":        {Available: true},
		"wake-on-lan":        {Available: true},
		"ping-monitor":       {Available: true}, // IcmpSendEcho / datagram — unprivileged
		"traceroute":         {Available: true},
		"port-scanner":       {Available: true},
		"network-scanner":    {Available: true}, // ICMP + port probe (ARP discovery needs elevation/Npcap — N4)
		"neighbor-table":     {Available: true},
		"hosts-editor":       {Available: true},
		"firewall-viewer":    {Available: true},
		"iperf3":             notImpl,
		"snmp":               {Available: true},
		"discovery-protocol": rawSocket(),
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"elevated":     elevated,
		"capabilities": caps,
	})
}
