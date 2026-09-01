package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/tools/connections"
	"github.com/infrakit/backend/internal/tools/ipgeo"
	"github.com/infrakit/backend/internal/tools/wol"
)

// Connections: GET /connections?kind=all|tcp|udp — netstat-style socket list.
func Connections(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	kind := r.URL.Query().Get("kind")
	result, err := connections.List(kind)
	if err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}
	env := envelope.Envelope{
		Tool:        "connections",
		Target:      hostname(),
		StartedAt:   started.UnixMilli(),
		FinishedAt:  time.Now().UnixMilli(),
		Status:      envelope.StatusOK,
		Params:      map[string]any{"kind": orDefault(kind, "all")},
		ResultShape: envelope.ShapeTable,
		Result:      result,
		Summary:     map[string]any{"total": len(result.Connections), "listening": result.Listening, "established": result.Established},
	}
	WriteJSON(w, http.StatusOK, map[string]any{"envelope": env})
}

type wolRequest struct {
	MAC       string `json:"mac"`
	Broadcast string `json:"broadcast"`
	Port      int    `json:"port"`
}

// WakeOnLAN: POST /wake-on-lan — send a magic packet. resultShape "text".
func WakeOnLAN(w http.ResponseWriter, r *http.Request) {
	var req wolRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	started := time.Now()
	result, err := wol.Send(req.MAC, req.Broadcast, req.Port)

	env := envelope.Envelope{
		Tool:        "wake-on-lan",
		Target:      strings.TrimSpace(req.MAC),
		StartedAt:   started.UnixMilli(),
		FinishedAt:  time.Now().UnixMilli(),
		Params:      map[string]any{"mac": req.MAC, "broadcast": req.Broadcast, "port": req.Port},
		ResultShape: envelope.ShapeText,
	}
	if err != nil {
		env.Status = envelope.StatusError
		env.Result = map[string]any{"v": 1, "text": "", "error": err.Error()}
		env.Summary = map[string]any{"error": err.Error()}
		WriteJSON(w, http.StatusOK, map[string]any{"envelope": env, "error": err.Error()})
		return
	}
	env.Status = envelope.StatusOK
	env.Result = result
	env.Summary = map[string]any{"bytesSent": result.BytesSent}
	WriteJSON(w, http.StatusOK, map[string]any{"envelope": env})
}

type ipGeoRequest struct {
	Query string `json:"query"`
}

// IPGeolocation: POST /ip-geolocation — ip-api.com lookup. resultShape "text".
func IPGeolocation(w http.ResponseWriter, r *http.Request) {
	var req ipGeoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	query := strings.TrimSpace(req.Query)
	if query == "" {
		apierr.Write(w, apierr.Validation("an IP or hostname is required"))
		return
	}

	started := time.Now()
	result, err := ipgeo.Lookup(r.Context(), nil, query)

	env := envelope.Envelope{
		Tool:        "ip-geolocation",
		Target:      query,
		StartedAt:   started.UnixMilli(),
		FinishedAt:  time.Now().UnixMilli(),
		Params:      map[string]any{"query": query},
		ResultShape: envelope.ShapeText,
	}
	if err != nil {
		env.Status = envelope.StatusError
		env.Result = map[string]any{"v": 1, "query": query, "text": "", "error": err.Error()}
		env.Summary = map[string]any{"error": err.Error()}
		WriteJSON(w, http.StatusOK, map[string]any{"envelope": env, "error": err.Error()})
		return
	}
	env.Status = envelope.StatusOK
	env.Result = result
	env.Summary = map[string]any{
		"country": result.Fields["country"],
		"isp":     result.Fields["isp"],
		"city":    result.Fields["city"],
	}
	WriteJSON(w, http.StatusOK, map[string]any{"envelope": env})
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}
