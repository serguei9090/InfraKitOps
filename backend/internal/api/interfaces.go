package api

import (
	"net"
	"net/http"
	"sort"
)

type ifaceAddr struct {
	CIDR    string `json:"cidr"`
	Family  string `json:"family"` // "v4" | "v6"
	Address string `json:"address"`
}

type ifaceInfo struct {
	Name         string      `json:"name"`
	Index        int         `json:"index"`
	MTU          int         `json:"mtu"`
	HardwareAddr string      `json:"hardwareAddr"`
	Up           bool        `json:"up"`
	Loopback     bool        `json:"loopback"`
	PointToPoint bool        `json:"pointToPoint"`
	Addrs        []ifaceAddr `json:"addrs"`
}

// Interfaces enumerates the host's network interfaces so the frontend can offer
// a "source interface" picker (module setting + per-tool override). Read-only,
// needs no privileges.
func Interfaces(w http.ResponseWriter, _ *http.Request) {
	ifaces, err := net.Interfaces()
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	out := make([]ifaceInfo, 0, len(ifaces))
	for _, ifi := range ifaces {
		info := ifaceInfo{
			Name:         ifi.Name,
			Index:        ifi.Index,
			MTU:          ifi.MTU,
			HardwareAddr: ifi.HardwareAddr.String(),
			Up:           ifi.Flags&net.FlagUp != 0,
			Loopback:     ifi.Flags&net.FlagLoopback != 0,
			PointToPoint: ifi.Flags&net.FlagPointToPoint != 0,
			Addrs:        []ifaceAddr{},
		}
		addrs, err := ifi.Addrs()
		if err == nil {
			for _, a := range addrs {
				ipnet, ok := a.(*net.IPNet)
				if !ok {
					continue
				}
				family := "v6"
				if ipnet.IP.To4() != nil {
					family = "v4"
				}
				info.Addrs = append(info.Addrs, ifaceAddr{
					CIDR:    ipnet.String(),
					Family:  family,
					Address: ipnet.IP.String(),
				})
			}
		}
		out = append(out, info)
	}

	// Stable order: up interfaces first, then by name.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Up != out[j].Up {
			return out[i].Up
		}
		return out[i].Name < out[j].Name
	})

	WriteJSON(w, http.StatusOK, map[string]any{"interfaces": out})
}
