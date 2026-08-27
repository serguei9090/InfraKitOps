package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/sse"
	"github.com/infrakit/backend/internal/tools/netscan"
	"github.com/infrakit/backend/internal/tools/portscan"
)

// NetScanStream: GET /network-scanner/stream (SSE)
//
//	?hosts=10.0.0.0/24&ports=22,80,443&resolve=true&sourceIp=10.0.0.5&showDead=false
//
// Events: "host" (netscan.HostResult), "progress", then "done" (RunEnvelope,
// shape "table").
func NetScanStream(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	hosts := splitList(q.Get("hosts"))
	if len(hosts) == 0 {
		sse.Reject(w, "at least one host is required")
		return
	}
	var ports []int
	if p := q.Get("ports"); p != "" {
		parsed, err := portscan.ParsePorts(p)
		if err != nil {
			sse.Reject(w, err.Error())
			return
		}
		ports = parsed
	}

	stream, err := sse.New(w)
	if err != nil {
		return
	}

	opts := netscan.Options{
		Hosts:        hosts,
		Timeout:      time.Duration(atoiOr(q.Get("timeoutMs"), 2000)) * time.Millisecond,
		Concurrency:  atoiOr(q.Get("concurrency"), 64),
		ResolveNames: q.Get("resolve") != "false",
		ProbePorts:   ports,
		SourceIP:     strings.TrimSpace(q.Get("sourceIp")),
		ShowDead:     q.Get("showDead") == "true",
	}

	started := time.Now()
	events := make(chan sse.Message, 256)
	go func() {
		defer close(events)
		result := netscan.Scan(r.Context(), opts, func(event string, payload any) {
			select {
			case events <- sse.Message{Event: event, Data: payload}:
			case <-r.Context().Done():
			}
		})
		status := envelope.StatusOK
		if r.Context().Err() != nil {
			status = envelope.StatusPartial
		}
		env := envelope.Envelope{
			Tool:        "network-scanner",
			Target:      q.Get("hosts"),
			StartedAt:   started.UnixMilli(),
			FinishedAt:  time.Now().UnixMilli(),
			Status:      status,
			Params:      map[string]any{"hosts": q.Get("hosts"), "ports": q.Get("ports"), "sourceIp": opts.SourceIP},
			ResultShape: envelope.ShapeTable,
			Result:      result,
			Summary:     map[string]any{"alive": result.Alive, "scanned": result.Total},
		}
		select {
		case events <- sse.Message{Event: "done", Data: env}:
		case <-r.Context().Done():
		}
	}()

	stream.Pump(r.Context(), events)
}
