//go:build !windows

package lldp

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

func captureMethod() string { return "lldpctl" }

// CaptureAvailable reports whether an LLDP/CDP capture can run here.
func CaptureAvailable() (bool, string) {
	if _, err := exec.LookPath("lldpctl"); err == nil {
		return true, ""
	}
	return false, "install lldpd (e.g. `apt install lldpd`) — it collects LLDP/CDP neighbors"
}

func captureImpl(
	ctx context.Context, iface string, window time.Duration,
	_ func(iface string, frame []byte), onParsed func(Neighbor), emit Emit,
) error {
	if ok, reason := CaptureAvailable(); !ok {
		return fmt.Errorf("%w: %s", ErrUnsupported, reason)
	}
	// lldpd already listens continuously; poll it a few times across the window
	// so a neighbor that appears mid-window is still caught.
	emit("note", "reading neighbors from lldpd…")
	deadline := time.Now().Add(window)
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()

	poll := func() {
		args := []string{"-f", "keyvalue"}
		if iface != "" {
			args = append(args, iface)
		}
		out, err := exec.CommandContext(ctx, "lldpctl", args...).Output()
		if err != nil {
			return
		}
		for _, n := range parseLldpctl(string(out)) {
			onParsed(n)
		}
	}

	poll()
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
			emit("tick", int(time.Until(deadline).Seconds()))
			poll()
		}
	}
	return nil
}

// parseLldpctl turns `lldpctl -f keyvalue` output into Neighbors.
//
//	lldp.eth0.via=LLDP
//	lldp.eth0.chassis.name=core-sw
//	lldp.eth0.chassis.mac=00:11:22:33:44:55
//	lldp.eth0.chassis.descr=Cisco IOS
//	lldp.eth0.chassis.Bridge.enabled=on
//	lldp.eth0.chassis.mgmt-ip=10.0.0.5
//	lldp.eth0.port.ifname=Gi1/0/1
//	lldp.eth0.port.descr=uplink
//	lldp.eth0.vlan.vlan-id=10
func parseLldpctl(s string) []Neighbor {
	byIface := map[string]*Neighbor{}
	get := func(ifn string) *Neighbor {
		if byIface[ifn] == nil {
			byIface[ifn] = &Neighbor{Iface: ifn, Protocol: "lldp"}
		}
		return byIface[ifn]
	}

	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := strings.Cut(line, "=")
		if !ok || !strings.HasPrefix(k, "lldp.") {
			continue
		}
		parts := strings.SplitN(k, ".", 3)
		if len(parts) < 3 {
			continue
		}
		ifn, rest := parts[1], parts[2]
		n := get(ifn)
		switch {
		case rest == "via":
			if strings.EqualFold(v, "CDP") {
				n.Protocol = "cdp"
			}
		case rest == "chassis.name":
			n.SystemName = v
		case rest == "chassis.mac", rest == "chassis.id":
			if n.ChassisID == "" {
				n.ChassisID = v
			}
		case rest == "chassis.descr":
			n.SystemDesc = v
		case rest == "chassis.mgmt-ip":
			n.MgmtAddrs = append(n.MgmtAddrs, v)
		case rest == "port.ifname", rest == "port.id":
			if n.PortID == "" {
				n.PortID = v
			}
		case rest == "port.descr":
			n.PortDesc = v
		case rest == "vlan.vlan-id":
			if x, err := strconv.Atoi(v); err == nil {
				n.NativeVLAN = x
			}
		case strings.HasPrefix(rest, "chassis.") && strings.HasSuffix(rest, ".enabled"):
			if strings.EqualFold(v, "on") {
				capName := strings.TrimSuffix(strings.TrimPrefix(rest, "chassis."), ".enabled")
				n.Capabilities = append(n.Capabilities, capName)
			}
		}
	}

	out := make([]Neighbor, 0, len(byIface))
	for _, n := range byIface {
		out = append(out, *n)
	}
	return out
}
