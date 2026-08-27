package api

import (
	"net/http"
	"time"

	"github.com/infrakit/backend/internal/sse"
	"github.com/infrakit/backend/internal/tools/ping"
)

// PingMonitorStream: GET /ping-monitor/stream (SSE)
//
//	?hosts=a;b&intervalMs=1000&timeoutMs=4000&upThreshold=1&downThreshold=3
//
// Runs until the client disconnects. Events: "sample", "stats", "status".
// There is no "done" event — a monitor stops by the client closing the
// stream, so the frontend builds and saves the history envelope from the
// stats it has accumulated (see NETWORK_MODULE_PLAN.md §2.3).
func PingMonitorStream(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	hosts := splitList(q.Get("hosts"))
	if len(hosts) == 0 {
		sse.Reject(w, "at least one host is required")
		return
	}

	stream, err := sse.New(w)
	if err != nil {
		return
	}

	opts := ping.Options{
		Hosts:         hosts,
		Interval:      time.Duration(atoiOr(q.Get("intervalMs"), 1000)) * time.Millisecond,
		Timeout:       time.Duration(atoiOr(q.Get("timeoutMs"), 4000)) * time.Millisecond,
		UpThreshold:   atoiOr(q.Get("upThreshold"), 1),
		DownThreshold: atoiOr(q.Get("downThreshold"), 3),
	}

	events := make(chan sse.Message, 512)
	go func() {
		defer close(events)
		ping.Monitor(r.Context(), opts, func(event string, payload any) {
			select {
			case events <- sse.Message{Event: event, Data: payload}:
			case <-r.Context().Done():
			}
		})
	}()

	stream.Pump(r.Context(), events)
}
