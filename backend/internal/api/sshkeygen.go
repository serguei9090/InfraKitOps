package api

import (
	"encoding/json"
	"net/http"

	"github.com/infrakit/backend/internal/tools/sshkeygen"
)

type sshKeygenRequest struct {
	Type       string `json:"type"`
	Bits       int    `json:"bits"`
	Curve      int    `json:"curve"`
	Comment    string `json:"comment"`
	Passphrase string `json:"passphrase"`
}

// SSHKeygen: POST /ssh-keygen — generate an SSH key pair (RSA / ECDSA / Ed25519,
// optionally passphrase-encrypted). Not history-tracked; the response is the
// key material itself. Private key crosses loopback only, is never written to
// disk by the backend.
func SSHKeygen(w http.ResponseWriter, r *http.Request) {
	var req sshKeygenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	res, err := sshkeygen.Generate(sshkeygen.Options{
		Type:       req.Type,
		Bits:       req.Bits,
		Curve:      req.Curve,
		Comment:    req.Comment,
		Passphrase: req.Passphrase,
	})
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	WriteJSON(w, http.StatusOK, res)
}
