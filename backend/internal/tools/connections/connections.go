// Package connections lists active TCP/UDP sockets with their owning process —
// a netstat equivalent. See NETWORK_MODULE_PLAN.md tool #13.
package connections

import (
	"fmt"
	"sort"

	psnet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"
)

// Conn is one socket row.
type Conn struct {
	Proto       string `json:"proto"` // tcp | tcp6 | udp | udp6
	LocalAddr   string `json:"localAddr"`
	LocalPort   uint32 `json:"localPort"`
	RemoteAddr  string `json:"remoteAddr,omitempty"`
	RemotePort  uint32 `json:"remotePort,omitempty"`
	State       string `json:"state"`
	PID         int32  `json:"pid,omitempty"`
	ProcessName string `json:"processName,omitempty"`
}

// Result — shape "table".
type Result struct {
	V           int    `json:"v"`
	Connections []Conn `json:"connections"`
	Listening   int    `json:"listening"`
	Established int    `json:"established"`
}

// List returns all IPv4/IPv6 TCP and UDP connections. `kind` is "all", "tcp",
// "udp", "inet", ... (gopsutil semantics).
func List(kind string) (Result, error) {
	if kind == "" {
		kind = "all"
	}
	conns, err := psnet.Connections(kind)
	if err != nil {
		return Result{}, err
	}

	nameCache := map[int32]string{}
	out := make([]Conn, 0, len(conns))
	res := Result{V: 1}
	for _, c := range conns {
		row := Conn{
			Proto:      protoLabel(c.Family, c.Type),
			LocalAddr:  c.Laddr.IP,
			LocalPort:  c.Laddr.Port,
			RemoteAddr: c.Raddr.IP,
			RemotePort: c.Raddr.Port,
			State:      c.Status,
			PID:        c.Pid,
		}
		if c.Pid != 0 {
			row.ProcessName = processName(c.Pid, nameCache)
		}
		switch c.Status {
		case "LISTEN":
			res.Listening++
		case "ESTABLISHED":
			res.Established++
		}
		out = append(out, row)
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Proto != out[j].Proto {
			return out[i].Proto < out[j].Proto
		}
		return out[i].LocalPort < out[j].LocalPort
	})
	res.Connections = out
	return res, nil
}

func processName(pid int32, cache map[int32]string) string {
	if n, ok := cache[pid]; ok {
		return n
	}
	name := ""
	if p, err := process.NewProcess(pid); err == nil {
		if n, err := p.Name(); err == nil {
			name = n
		}
	}
	cache[pid] = name
	return name
}

func protoLabel(family, sockType uint32) string {
	// AF_INET=2, AF_INET6=23/10; SOCK_STREAM=1, SOCK_DGRAM=2
	base := "tcp"
	if sockType == 2 {
		base = "udp"
	}
	if family == 23 || family == 10 || family == 30 {
		return base + "6"
	}
	return base
}

// Describe is a tiny helper for logging/debug.
func Describe(c Conn) string {
	return fmt.Sprintf("%s %s:%d -> %s:%d %s", c.Proto, c.LocalAddr, c.LocalPort, c.RemoteAddr, c.RemotePort, c.State)
}
