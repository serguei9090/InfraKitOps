package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/tools/dnslookup"
)

type dnsRequest struct {
	Name      string   `json:"name"`
	Types     []string `json:"types"`
	Resolver  string   `json:"resolver"`
	TCP       bool     `json:"tcp"`
	Recursion *bool    `json:"recursion"`
	TimeoutMs int      `json:"timeoutMs"`
}

// DNSLookup: POST /dns-lookup — resultShape "set" (records keyed by TYPE+value).
func DNSLookup(w http.ResponseWriter, r *http.Request) {
	var req dnsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		apierr.Write(w, apierr.Validation("a name is required"))
		return
	}
	recursion := true
	if req.Recursion != nil {
		recursion = *req.Recursion
	}

	started := time.Now()
	result, err := dnslookup.Query(dnslookup.Options{
		Name:      req.Name,
		Types:     req.Types,
		Resolver:  req.Resolver,
		TCP:       req.TCP,
		Recursion: recursion,
		Timeout:   time.Duration(req.TimeoutMs) * time.Millisecond,
	})
	if err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}

	items := make([]map[string]any, 0, len(result.Records))
	for _, rec := range result.Records {
		items = append(items, map[string]any{
			"key":    fmt.Sprintf("%s %s", rec.Type, rec.Value),
			"label":  rec.Type,
			"detail": fmt.Sprintf("%s   TTL %d", rec.Value, rec.TTL),
		})
	}

	status := envelope.StatusOK
	if len(result.Errors) > 0 {
		if len(result.Records) == 0 {
			status = envelope.StatusError
		} else {
			status = envelope.StatusPartial
		}
	}

	env := envelope.Envelope{
		Tool:        "dns-lookup",
		Target:      strings.TrimSpace(req.Name),
		StartedAt:   started.UnixMilli(),
		FinishedAt:  time.Now().UnixMilli(),
		Status:      status,
		Params:      map[string]any{"name": req.Name, "types": req.Types, "resolver": result.Resolver, "tcp": req.TCP},
		ResultShape: envelope.ShapeSet,
		Result:      map[string]any{"v": 1, "items": items, "records": result.Records, "resolver": result.Resolver, "protocol": result.Protocol, "errors": result.Errors},
		Summary:     map[string]any{"recordCount": len(result.Records), "resolver": result.Resolver},
	}
	WriteJSON(w, http.StatusOK, map[string]any{"envelope": env})
}
