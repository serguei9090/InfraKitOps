package lldp

import (
	"context"
	"errors"
	"time"
)

// CaptureResult is the collated set of neighbors seen in one window.
type CaptureResult struct {
	V         int              `json:"v"`
	Method    string           `json:"method"` // "pktmon" | "lldpctl" | "af_packet"
	WindowSec int              `json:"windowSec"`
	Neighbors []Neighbor       `json:"neighbors"`
	Items     []map[string]any `json:"items"` // shape "set" — for history diff
}

func (r *CaptureResult) rebuildItems() {
	r.Items = make([]map[string]any, 0, len(r.Neighbors))
	for _, n := range r.Neighbors {
		r.Items = append(r.Items, map[string]any{
			"key":    n.Key(),
			"label":  n.Iface,
			"detail": n.SystemName + " " + n.PortID,
		})
	}
}

// Emit streams capture progress: "tick" (secondsLeft int), "neighbor"
// (Neighbor), "note" (string).
type Emit func(event string, payload any)

// ErrUnsupported is returned when the OS has no usable capture backend.
var ErrUnsupported = errors.New("lldp capture is not available on this host")

// Capture listens for LLDP + CDP advertisements on `iface` ("" = every
// interface) for `window`, deduping by (iface, protocol, chassis, port). The
// OS backend is captureImpl (pktmon on Windows, lldpctl on Linux).
func Capture(ctx context.Context, iface string, window time.Duration, emit Emit) (CaptureResult, error) {
	if window <= 0 || window > 5*time.Minute {
		window = 65 * time.Second
	}
	res := CaptureResult{V: 1, Method: captureMethod(), WindowSec: int(window.Seconds()), Neighbors: []Neighbor{}}

	seen := map[string]bool{}
	onNeighbor := func(ifaceName string, frame []byte) {
		n, err := ParseEthernet(frame)
		if err != nil || n == nil || (n.SystemName == "" && n.ChassisID == "") {
			return
		}
		if ifaceName != "" {
			n.Iface = ifaceName
		} else {
			n.Iface = iface
		}
		if n.SeenAt == 0 {
			n.SeenAt = time.Now().UnixMilli()
		}
		if seen[n.Key()] {
			return
		}
		seen[n.Key()] = true
		res.Neighbors = append(res.Neighbors, *n)
		emit("neighbor", *n)
	}

	// direct-neighbor backends (lldpctl) hand us Neighbor values, not frames
	onParsed := func(n Neighbor) {
		if n.SystemName == "" && n.ChassisID == "" {
			return
		}
		if n.SeenAt == 0 {
			n.SeenAt = time.Now().UnixMilli()
		}
		if seen[n.Key()] {
			return
		}
		seen[n.Key()] = true
		res.Neighbors = append(res.Neighbors, n)
		emit("neighbor", n)
	}

	err := captureImpl(ctx, iface, window, onNeighbor, onParsed, emit)
	res.rebuildItems()
	return res, err
}
