package api

import (
	"net/http"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/backup"
)

// AdminHandlers wires the small set of instance-wide admin actions that don't
// belong to a module. Nil fields → that action 503s.
type AdminHandlers struct {
	Backup *backup.Scheduler
}

// BackupNow: POST /admin/backup — take a DB+vault snapshot immediately.
// Admin-only, audited. 503 when --backup-dir was not set.
func (h *AdminHandlers) BackupNow(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	if h == nil || h.Backup == nil {
		apierr.Write(w, apierr.Unavailable("backups (start the backend with --backup-dir)"))
		return
	}
	path, err := h.Backup.Once()
	if err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}
	audit(r, "backup_now", path, nil)
	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok", "archive": path})
}
