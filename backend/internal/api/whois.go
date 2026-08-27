package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/tools/whois"
)

type whoisRequest struct {
	Query     string `json:"query"`
	TimeoutMs int    `json:"timeoutMs"`
}

// Whois: POST /whois — domain or IP WHOIS lookup. resultShape "text".
func Whois(w http.ResponseWriter, r *http.Request) {
	var req whoisRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	query := strings.TrimSpace(req.Query)
	if query == "" {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "a domain or IP is required"})
		return
	}

	started := time.Now()
	result, err := whois.Query(query, time.Duration(req.TimeoutMs)*time.Millisecond)

	env := envelope.Envelope{
		Tool:        "whois",
		Target:      query,
		StartedAt:   started.UnixMilli(),
		FinishedAt:  time.Now().UnixMilli(),
		Params:      map[string]any{"query": query, "timeoutMs": req.TimeoutMs},
		ResultShape: envelope.ShapeText,
	}
	if err != nil {
		env.Status = envelope.StatusError
		env.Result = whois.Result{V: 1, Query: query, Text: "", ParseError: err.Error()}
		env.Summary = map[string]any{"error": err.Error()}
		WriteJSON(w, http.StatusOK, map[string]any{"envelope": env, "error": err.Error()})
		return
	}

	env.Status = envelope.StatusOK
	env.Result = result
	env.Summary = map[string]any{
		"registrar":      result.Parsed.Registrar,
		"expirationDate": result.Parsed.ExpirationDate,
		"nameServers":    len(result.Parsed.NameServers),
	}
	WriteJSON(w, http.StatusOK, map[string]any{"envelope": env})
}
