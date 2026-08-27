package api

import (
	"net/http"
	"time"

	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/tools/neighbor"
)

// NeighborTable: GET /neighbor-table — the OS ARP/NDP cache. resultShape "table".
func NeighborTable(w http.ResponseWriter, _ *http.Request) {
	started := time.Now()
	result, err := neighbor.List()
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	env := envelope.Envelope{
		Tool:        "neighbor-table",
		Target:      hostname(),
		StartedAt:   started.UnixMilli(),
		FinishedAt:  time.Now().UnixMilli(),
		Status:      envelope.StatusOK,
		Params:      map[string]any{},
		ResultShape: envelope.ShapeTable,
		Result:      result,
		Summary:     map[string]any{"entries": len(result.Entries)},
	}
	WriteJSON(w, http.StatusOK, map[string]any{"envelope": env})
}
