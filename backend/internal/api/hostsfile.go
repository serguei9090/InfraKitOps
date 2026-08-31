package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/tools/hostsfile"
)

// elevationErr is the shared "this needs administrator rights" reply — a
// permission-coded error plus the `needsElevation` flag the UI already reads.
func elevationErr(w http.ResponseWriter, err error) {
	e := apierr.Permission(err.Error())
	e.Hint = "Restart the app as an administrator to make this change."
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(e.Status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"code": e.Code, "error": e.Message, "hint": e.Hint, "needsElevation": true,
	})
}

// HostsGet: GET /hosts — parse the system hosts file. resultShape "table".
func HostsGet(w http.ResponseWriter, _ *http.Request) {
	f, err := hostsfile.Parse()
	if err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
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
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if err := hostsfile.Apply(req.Lines); err != nil {
		if errors.Is(err, hostsfile.ErrNeedsElevation) {
			elevationErr(w, err)
			return
		}
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}
	WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// HostsRestore: POST /hosts/restore — restore the newest backup.
func HostsRestore(w http.ResponseWriter, _ *http.Request) {
	if err := hostsfile.RestoreLatest(); err != nil {
		if errors.Is(err, hostsfile.ErrNeedsElevation) {
			elevationErr(w, err)
			return
		}
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}
	WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
