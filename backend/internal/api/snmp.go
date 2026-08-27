package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/tools/snmp"
)

type snmpRequest struct {
	Host      string   `json:"host"`
	Port      uint16   `json:"port"`
	Version   string   `json:"version"`
	Community string   `json:"community"`
	Mode      string   `json:"mode"`
	OIDs      []string `json:"oids"`
	TimeoutMs int      `json:"timeoutMs"`
	Retries   int      `json:"retries"`
	SecLevel  string   `json:"secLevel"`
	Username  string   `json:"username"`
	AuthProto string   `json:"authProto"`
	AuthKey   string   `json:"authKey"`
	PrivProto string   `json:"privProto"`
	PrivKey   string   `json:"privKey"`
}

// SNMP: POST /snmp — Get or Walk. resultShape "set" keyed by OID.
func SNMP(w http.ResponseWriter, r *http.Request) {
	var req snmpRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if strings.TrimSpace(req.Host) == "" {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "a host is required"})
		return
	}
	mode := req.Mode
	if mode != "walk" {
		mode = "get"
	}

	started := time.Now()
	result, err := snmp.Query(r.Context(), snmp.Options{
		Host:      strings.TrimSpace(req.Host),
		Port:      req.Port,
		Version:   req.Version,
		Community: req.Community,
		Mode:      mode,
		OIDs:      req.OIDs,
		Timeout:   time.Duration(req.TimeoutMs) * time.Millisecond,
		Retries:   req.Retries,
		SecLevel:  req.SecLevel,
		Username:  req.Username,
		AuthProto: req.AuthProto,
		AuthKey:   req.AuthKey,
		PrivProto: req.PrivProto,
		PrivKey:   req.PrivKey,
	})

	env := envelope.Envelope{
		Tool:        "snmp",
		Target:      strings.TrimSpace(req.Host),
		StartedAt:   started.UnixMilli(),
		FinishedAt:  time.Now().UnixMilli(),
		Params:      map[string]any{"host": req.Host, "version": req.Version, "mode": mode, "oids": req.OIDs},
		ResultShape: envelope.ShapeSet,
	}
	if err != nil {
		env.Status = envelope.StatusError
		env.Result = result
		env.Summary = map[string]any{"error": err.Error(), "rows": len(result.Rows)}
		WriteJSON(w, http.StatusOK, map[string]any{"envelope": env, "error": err.Error()})
		return
	}
	env.Status = envelope.StatusOK
	env.Result = result
	env.Summary = map[string]any{"rows": len(result.Rows), "mode": mode}
	WriteJSON(w, http.StatusOK, map[string]any{"envelope": env})
}
