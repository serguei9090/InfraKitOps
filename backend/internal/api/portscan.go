package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/sse"
	"github.com/infrakit/backend/internal/tools/portscan"
)

// PortScanStream: GET /port-scanner/stream (SSE)
//
//	?hosts=a;b&ports=22,80,1-1024&timeoutMs=4000&hostConcurrency=4&portConcurrency=128&showClosed=false
//
// Events: "open" / "closed" (PortResult), "progress" (Progress), "done" (RunEnvelope), "error".
func PortScanStream(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	hosts := splitList(q.Get("hosts"))
	if len(hosts) == 0 {
		sse.RejectCoded(w, string(apierr.CodeValidation), "at least one host is required", "")
		return
	}
	ports, err := portscan.ParsePorts(q.Get("ports"))
	if err != nil {
		sse.RejectCoded(w, string(apierr.CodeValidation), err.Error(), "")
		return
	}
	if len(ports) == 0 {
		sse.RejectCoded(w, string(apierr.CodeValidation), "at least one port is required", "")
		return
	}

	stream, err := sse.New(w)
	if err != nil {
		return
	}

	opts := portscan.Options{
		Hosts:           hosts,
		Ports:           ports,
		Timeout:         time.Duration(intParamQ(q, "timeoutMs", 4000)) * time.Millisecond,
		HostConcurrency: intParamQ(q, "hostConcurrency", 4),
		PortConcurrency: intParamQ(q, "portConcurrency", 128),
		ShowClosed:      q.Get("showClosed") == "true",
	}

	started := time.Now()
	events := make(chan sse.Message, 256)
	go func() {
		defer close(events)
		result := portscan.Scan(r.Context(), opts, func(event string, payload any) {
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
			Tool:        "port-scanner",
			Target:      strings.Join(hosts, "; "),
			StartedAt:   started.UnixMilli(),
			FinishedAt:  time.Now().UnixMilli(),
			Status:      status,
			Params:      map[string]any{"hosts": hosts, "ports": q.Get("ports"), "showClosed": opts.ShowClosed},
			ResultShape: envelope.ShapeSet,
			Result:      result,
			Summary:     map[string]any{"openCount": len(result.Open), "portsProbed": result.Total},
		}
		select {
		case events <- sse.Message{Event: "done", Data: env}:
		case <-r.Context().Done():
		}
	}()

	stream.Pump(r.Context(), events)
}

func splitList(s string) []string {
	out := []string{}
	for _, p := range strings.FieldsFunc(s, func(r rune) bool { return r == ';' || r == ',' || r == '\n' || r == ' ' }) {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func intParamQ(q map[string][]string, name string, def int) int {
	vs, ok := q[name]
	if !ok || len(vs) == 0 {
		return def
	}
	return atoiOr(vs[0], def)
}
