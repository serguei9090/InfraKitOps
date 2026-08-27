package api

import (
	"net/http"
	"time"

	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/tools/firewall"
)

// FirewallView: GET /firewall-viewer — read-only OS firewall rule set.
// resultShape "text" (the whole rule list is diffed as a snapshot).
func FirewallView(w http.ResponseWriter, _ *http.Request) {
	started := time.Now()
	result, err := firewall.List()
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	env := envelope.Envelope{
		Tool:        "firewall-viewer",
		Target:      result.Backend,
		StartedAt:   started.UnixMilli(),
		FinishedAt:  time.Now().UnixMilli(),
		Status:      envelope.StatusOK,
		Params:      map[string]any{},
		ResultShape: envelope.ShapeTable,
		Result:      result,
		Summary:     map[string]any{"backend": result.Backend, "rules": len(result.Rules)},
	}
	WriteJSON(w, http.StatusOK, map[string]any{"envelope": env})
}
