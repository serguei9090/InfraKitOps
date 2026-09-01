package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/tools/sntp"
)

type sntpRequest struct {
	Servers   []string `json:"servers"`
	TimeoutMs int      `json:"timeoutMs"`
}

// SNTP: POST /sntp — query NTP servers for clock offset + round-trip delay.
// Returns { envelope } where envelope.result is a sntp.Result.
func SNTP(w http.ResponseWriter, r *http.Request) {
	var req sntpRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	servers := cleanList(req.Servers)
	if len(servers) == 0 {
		apierr.Write(w, apierr.Validation("at least one server is required"))
		return
	}

	started := time.Now()
	result := sntp.Query(sntp.Options{
		Servers: servers,
		Timeout: time.Duration(req.TimeoutMs) * time.Millisecond,
	})

	status := envelope.StatusOK
	switch {
	case result.OKCount == 0:
		status = envelope.StatusError
	case result.OKCount < len(servers):
		status = envelope.StatusPartial
	}

	env := envelope.Envelope{
		Tool:        "sntp",
		Target:      strings.Join(servers, "; "),
		StartedAt:   started.UnixMilli(),
		FinishedAt:  time.Now().UnixMilli(),
		Status:      status,
		Params:      map[string]any{"servers": servers, "timeoutMs": req.TimeoutMs},
		ResultShape: envelope.ShapeTable,
		Result:      result,
		Summary: map[string]any{
			"medianOffsetSec": result.MedianOffsetSec,
			"okCount":         result.OKCount,
			"serverCount":     len(servers),
		},
	}
	WriteJSON(w, http.StatusOK, map[string]any{"envelope": env})
}

func cleanList(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}
