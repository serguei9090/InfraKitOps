package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/elevate"
	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/fwspec"
	"github.com/infrakit/backend/internal/tools/firewall"
)

// FirewallView: GET /firewall-viewer — read-only OS firewall rule set.
// resultShape "text" (the whole rule list is diffed as a snapshot).
func FirewallView(w http.ResponseWriter, _ *http.Request) {
	started := time.Now()
	result, err := firewall.List()
	if err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
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

type fwChangeRequest struct {
	Op        string          `json:"op"`
	Rule      fwspec.RuleSpec `json:"rule"`
	Confirmed bool            `json:"confirmed"`
}

// FirewallChange: POST /firewall/change — add / delete / enable-disable one
// OS firewall rule (Windows only in this release). A change that could cut off
// remote management returns { needsConfirmation, warnings } until the caller
// re-sends it with confirmed:true. The apply itself runs through the elevated
// helper (one UAC prompt).
func FirewallChange(w http.ResponseWriter, r *http.Request) {
	var req fwChangeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	change := fwspec.Change{Op: fwspec.ChangeOp(req.Op), Rule: req.Rule}
	if _, err := fwspec.NetshArgs(change); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}

	warnings := fwspec.AssessLockout(change)
	if len(warnings) > 0 && !req.Confirmed {
		WriteJSON(w, http.StatusOK, map[string]any{"needsConfirmation": true, "warnings": warnings})
		return
	}

	if err := firewall.Apply(change); err != nil {
		switch {
		case errors.Is(err, firewall.ErrWriteUnsupported):
			e := apierr.Validation(err.Error())
			e.Hint = "Firewall writes are Windows-only in this release."
			apierr.Write(w, e)
		case errors.Is(err, elevate.ErrHelperMissing):
			e := apierr.Internal("the elevated helper is not installed next to the backend — firewall edits need it")
			e.Hint = "Reinstall the app so infrakit-helper sits next to the backend binary."
			apierr.Write(w, e)
		default:
			e := apierr.Validation(err.Error())
			e.Hint = "The firewall rule change was rejected — check the rule fields."
			apierr.Write(w, e)
		}
		return
	}

	result, _ := firewall.List()
	WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "warnings": warnings, "result": result})
}
