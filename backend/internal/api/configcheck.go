package api

import (
	"encoding/json"
	"net/http"
	"strings"

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
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "nothing to validate"})
		return
	}
	res, err := configcheck.Validate(r.Context(), configcheck.Kind(req.Kind), req.Text)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	WriteJSON(w, http.StatusOK, res)
}
