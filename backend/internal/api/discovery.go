package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/sse"
	"github.com/infrakit/backend/internal/tools/lldp"
)

// DiscoveryStream: GET /discovery/stream?iface=&windowMs= (SSE)
//
// Listens for LLDP + CDP neighbor advertisements. Events: "note" (string),
// "tick" (secondsLeft), "neighbor" (lldp.Neighbor), then "done"
// (RunEnvelope, shape "set").
func DiscoveryStream(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	iface := strings.TrimSpace(q.Get("iface"))
	window := time.Duration(atoiOr(q.Get("windowMs"), 65000)) * time.Millisecond

	stream, err := sse.New(w)
	if err != nil {
		return
	}

	started := time.Now()
	events := make(chan sse.Message, 64)
	go func() {
		defer close(events)
		send := func(m sse.Message) {
			select {
			case events <- m:
			case <-r.Context().Done():
			}
		}

		res, rerr := lldp.Capture(r.Context(), iface, window, func(ev string, payload any) {
			send(sse.Message{Event: ev, Data: payload})
		})

		status := envelope.StatusOK
		switch {
		case rerr != nil:
			status = envelope.StatusError
		case len(res.Neighbors) == 0:
			status = envelope.StatusPartial
		}
		if rerr != nil {
			send(sse.Message{Event: "error", Data: map[string]any{"error": rerr.Error()}})
		}
		env := envelope.Envelope{
			Tool:        "discovery-protocol",
			Target:      nz(iface, "all interfaces"),
			StartedAt:   started.UnixMilli(),
			FinishedAt:  time.Now().UnixMilli(),
			Status:      status,
			Params:      map[string]any{"iface": iface, "windowSec": res.WindowSec},
			ResultShape: envelope.ShapeSet,
			Result:      res,
			Summary:     map[string]any{"count": len(res.Neighbors), "method": res.Method},
		}
		send(sse.Message{Event: "done", Data: env})
	}()

	stream.Pump(r.Context(), events)
}
