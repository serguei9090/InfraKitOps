package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/tools/configcheck"
)

type configCheckRequest struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

// ConfigValidate: POST /config/validate { kind, text } — run the matching
// OS validator in check-only mode. Never writes real config, never needs root.
// Returns { available:false } when the validator is not installed.
func ConfigValidate(w http.ResponseWriter, r *http.Request) {
	var req configCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		apierr.Write(w, apierr.Validation("nothing to validate"))
		return
	}
	res, err := configcheck.Validate(r.Context(), configcheck.Kind(req.Kind), req.Text)
	if err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}
	WriteJSON(w, http.StatusOK, res)
}
