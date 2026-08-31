package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/vault"
)

// VaultHandlers wires /vault*. Nil Vault → 503.
type VaultHandlers struct {
	Vault *vault.Vault
}

func (h *VaultHandlers) guard(w http.ResponseWriter) bool {
	if h == nil || h.Vault == nil {
		WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "vault unavailable"})
		return false
	}
	return true
}

func vaultErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, vault.ErrLocked):
		WriteJSON(w, http.StatusForbidden, map[string]string{"error": "vault is locked"})
	case errors.Is(err, vault.ErrBadPassword):
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "wrong master password"})
	case errors.Is(err, vault.ErrNotInitialised):
		WriteJSON(w, http.StatusConflict, map[string]string{"error": "vault not initialised"})
	case errors.Is(err, vault.ErrExists):
		WriteJSON(w, http.StatusConflict, map[string]string{"error": "vault already initialised"})
	case errors.Is(err, vault.ErrNoSecret):
		WriteJSON(w, http.StatusNotFound, map[string]string{"error": "no such secret"})
	default:
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
}

func (h *VaultHandlers) Status(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	WriteJSON(w, http.StatusOK, h.Vault.Status())
}

func (h *VaultHandlers) Init(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var b struct{ MasterPassword string `json:"masterPassword"` }
	_ = json.NewDecoder(r.Body).Decode(&b)
	if err := h.Vault.Init(b.MasterPassword); err != nil {
		vaultErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, h.Vault.Status())
}

func (h *VaultHandlers) Unlock(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var b struct{ MasterPassword string `json:"masterPassword"` }
	_ = json.NewDecoder(r.Body).Decode(&b)
	if err := h.Vault.Unlock(b.MasterPassword); err != nil {
		vaultErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, h.Vault.Status())
}

func (h *VaultHandlers) Lock(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	h.Vault.Lock()
	WriteJSON(w, http.StatusOK, h.Vault.Status())
}

func (h *VaultHandlers) ListSecrets(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"secrets": h.Vault.List()})
}

func (h *VaultHandlers) PutSecret(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var b struct {
		Name  string `json:"name"`
		Kind  string `json:"kind"`
		Notes string `json:"notes"`
		Value string `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	kind := vault.SecretKind(b.Kind)
	if kind == "" {
		kind = vault.KindOther
	}
	id, err := h.Vault.Put(chi.URLParam(r, "id"), b.Name, kind, b.Notes, b.Value)
	if err != nil {
		vaultErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"id": id})
}

func (h *VaultHandlers) DeleteSecret(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Vault.Delete(chi.URLParam(r, "id")); err != nil {
		vaultErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *VaultHandlers) Export(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	b, err := h.Vault.ExportBytes()
	if err != nil {
		vaultErr(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="vault.enc"`)
	_, _ = w.Write(b)
}

func (h *VaultHandlers) Import(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var b struct {
		MasterPassword string          `json:"masterPassword"`
		File           json.RawMessage `json:"file"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(&b); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := h.Vault.ImportBytes(b.File, b.MasterPassword); err != nil {
		vaultErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, h.Vault.Status())
}
