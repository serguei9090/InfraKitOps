package api

import (
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/sse"
	"github.com/infrakit/backend/internal/tools/ipgeo"
	"github.com/infrakit/backend/internal/tools/traceroute"
)

// TracerouteStream: GET /traceroute/stream (SSE)
//
//	?host=example.com&maxHops=30&probes=3&timeoutMs=4000&resolve=true&geo=false
//
// Events: "hop" (traceroute.Hop) then "done" (RunEnvelope, shape "set").
func TracerouteStream(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	host := strings.TrimSpace(q.Get("host"))
	if host == "" {
		sse.Reject(w, "a host is required")
		return
	}

	stream, err := sse.New(w)
	if err != nil {
		return
	}

	wantGeo := q.Get("geo") == "true"
	opts := traceroute.Options{
		Host:         host,
		MaxHops:      atoiOr(q.Get("maxHops"), 30),
		ProbesPerHop: atoiOr(q.Get("probes"), 3),
		Timeout:      time.Duration(atoiOr(q.Get("timeoutMs"), 4000)) * time.Millisecond,
		ResolveNames: q.Get("resolve") != "false",
	}

	started := time.Now()
	events := make(chan sse.Message, 128)
	go func() {
		defer close(events)
		result, rerr := traceroute.Run(r.Context(), opts, func(event string, payload any) {
			hop, _ := payload.(traceroute.Hop)
			if wantGeo && hop.Addr != "" && !isPrivate(hop.Addr) {
				enrichGeo(r, &hop)
			}
			select {
			case events <- sse.Message{Event: "hop", Data: hop}:
			case <-r.Context().Done():
			}
		})

		status := envelope.StatusOK
		switch {
		case rerr != nil:
			status = envelope.StatusError
		case !result.Reached:
			status = envelope.StatusPartial
		}
		env := envelope.Envelope{
			Tool:        "traceroute",
			Target:      host,
			StartedAt:   started.UnixMilli(),
			FinishedAt:  time.Now().UnixMilli(),
			Status:      status,
			Params:      map[string]any{"host": host, "maxHops": opts.MaxHops, "geo": wantGeo},
			ResultShape: envelope.ShapeSet,
			Result:      result,
			Summary:     map[string]any{"hopCount": result.HopCount, "reached": result.Reached, "destIp": result.DestIP},
		}
		select {
		case events <- sse.Message{Event: "done", Data: env}:
		case <-r.Context().Done():
		}
	}()

	stream.Pump(r.Context(), events)
}

func enrichGeo(r *http.Request, hop *traceroute.Hop) {
	res, err := ipgeo.Lookup(r.Context(), nil, hop.Addr)
	if err != nil {
		return
	}
	str := func(k string) string { s, _ := res.Fields[k].(string); return s }
	num := func(k string) float64 { f, _ := res.Fields[k].(float64); return f }
	hop.Country = str("country")
	hop.City = str("city")
	hop.ISP = str("isp")
	hop.Lat = num("lat")
	hop.Lon = num("lon")
}

func isPrivate(ipStr string) bool {
	ip := net.ParseIP(ipStr)
	return ip == nil || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast()
}
