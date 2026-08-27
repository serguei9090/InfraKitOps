package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/tools/hostsfile"
)

// HostsGet: GET /hosts — parse the system hosts file. resultShape "table".
func HostsGet(w http.ResponseWriter, _ *http.Request) {
	f, err := hostsfile.Parse()
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	backups, _ := hostsfile.Backups()
	env := envelope.Envelope{
		Tool:        "hosts-editor",
		Target:      f.Path,
		StartedAt:   time.Now().UnixMilli(),
		FinishedAt:  time.Now().UnixMilli(),
		Status:      envelope.StatusOK,
		Params:      map[string]any{},
		ResultShape: envelope.ShapeTable,
		Result:      f,
		Summary:     map[string]any{"lines": len(f.Lines), "backups": len(backups)},
	}
	WriteJSON(w, http.StatusOK, map[string]any{"envelope": env, "backups": backups})
}

type hostsApplyRequest struct {
	Lines []hostsfile.Line `json:"lines"`
}

// HostsApply: POST /hosts — write the given line list (backup + atomic replace).
func HostsApply(w http.ResponseWriter, r *http.Request) {
	var req hostsApplyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := hostsfile.Apply(req.Lines); err != nil {
		if errors.Is(err, hostsfile.ErrNeedsElevation) {
			WriteJSON(w, http.StatusForbidden, map[string]any{"error": err.Error(), "needsElevation": true})
			return
		}
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// HostsRestore: POST /hosts/restore — restore the newest backup.
func HostsRestore(w http.ResponseWriter, _ *http.Request) {
	if err := hostsfile.RestoreLatest(); err != nil {
		if errors.Is(err, hostsfile.ErrNeedsElevation) {
			WriteJSON(w, http.StatusForbidden, map[string]any{"error": err.Error(), "needsElevation": true})
			return
		}
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
