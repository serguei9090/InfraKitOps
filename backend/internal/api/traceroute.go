package api

import (
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/sse"
	"github.com/infrakit/backend/internal/tools/ipgeo"
	"github.com/infrakit/backend/internal/tools/traceroute"
)

// TracerouteStream: GET /traceroute/stream (SSE)
//
//	?host=example.com&maxHops=30&probes=3&timeoutMs=4000&resolve=true&geo=false
//	&rounds=1&continuous=false&intervalMs=1000
//
// Events: "hop-update" (traceroute.HopStat) after every hop of every round,
// "hop" (traceroute.Hop) on the first round only (legacy), then "done"
// (RunEnvelope, shape "set").
func TracerouteStream(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	host := strings.TrimSpace(q.Get("host"))
	if host == "" {
		sse.RejectCoded(w, string(apierr.CodeValidation), "a host is required", "")
		return
	}

	stream, err := sse.New(w)
	if err != nil {
		return
	}

	wantGeo := q.Get("geo") == "true"
	rounds := atoiOr(q.Get("rounds"), 1)
	if q.Get("continuous") == "true" {
		rounds = -1
	}
	opts := traceroute.Options{
		Host:         host,
		MaxHops:      atoiOr(q.Get("maxHops"), 30),
		ProbesPerHop: atoiOr(q.Get("probes"), 3),
		Timeout:      time.Duration(atoiOr(q.Get("timeoutMs"), 4000)) * time.Millisecond,
		ResolveNames: q.Get("resolve") != "false",
		Rounds:       rounds,
		Interval:     time.Duration(atoiOr(q.Get("intervalMs"), 1000)) * time.Millisecond,
	}

	started := time.Now()
	events := make(chan sse.Message, 128)
	go func() {
		defer close(events)
		send := func(m sse.Message) {
			select {
			case events <- m:
			case <-r.Context().Done():
			}
		}

		// one geo lookup per distinct responder, reused across rounds
		type geoVals struct {
			country, city, isp string
			lat, lon           float64
		}
		geoCache := map[string]geoVals{}
		geoFor := func(addr string) geoVals {
			if g, ok := geoCache[addr]; ok {
				return g
			}
			g := geoVals{}
			if res, gerr := ipgeo.Lookup(r.Context(), nil, addr); gerr == nil {
				g.country, _ = res.Fields["country"].(string)
				g.city, _ = res.Fields["city"].(string)
				g.isp, _ = res.Fields["isp"].(string)
				g.lat, _ = res.Fields["lat"].(float64)
				g.lon, _ = res.Fields["lon"].(float64)
			}
			geoCache[addr] = g
			return g
		}

		result, rerr := traceroute.Run(r.Context(), opts, func(event string, payload any) {
			switch event {
			case "round":
				send(sse.Message{Event: "round", Data: payload})
			case "hop":
				hop, _ := payload.(traceroute.Hop)
				if wantGeo && hop.Addr != "" && !isPrivate(hop.Addr) {
					g := geoFor(hop.Addr)
					hop.Country, hop.City, hop.ISP, hop.Lat, hop.Lon = g.country, g.city, g.isp, g.lat, g.lon
				}
				send(sse.Message{Event: "hop", Data: hop})
			case "hop-update":
				st, _ := payload.(traceroute.HopStat)
				if wantGeo && st.Addr != "" && !isPrivate(st.Addr) {
					g := geoFor(st.Addr)
					st.Country, st.City, st.ISP, st.Lat, st.Lon = g.country, g.city, g.isp, g.lat, g.lon
				}
				send(sse.Message{Event: "hop-update", Data: st})
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
			Params:      map[string]any{"host": host, "maxHops": opts.MaxHops, "geo": wantGeo, "rounds": opts.Rounds},
			ResultShape: envelope.ShapeSet,
			Result:      result,
			Summary:     map[string]any{"hopCount": result.HopCount, "reached": result.Reached, "destIp": result.DestIP, "rounds": result.Rounds},
		}
		send(sse.Message{Event: "done", Data: env})
	}()

	stream.Pump(r.Context(), events)
}

func isPrivate(ipStr string) bool {
	ip := net.ParseIP(ipStr)
	return ip == nil || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast()
}
