package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/vault"
)

// VaultHandlers wires /vault*. Nil Vault → 503.
type VaultHandlers struct {
	Vault *vault.Vault
}

func (h *VaultHandlers) guard(w http.ResponseWriter) bool {
	if h == nil || h.Vault == nil {
		apierr.Write(w, apierr.Unavailable("the vault"))
		return false
	}
	return true
}

func vaultErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, vault.ErrLocked):
		apierr.Write(w, apierr.Locked("the vault is locked"))
	case errors.Is(err, vault.ErrBadPassword):
		e := apierr.Auth("wrong master password")
		e.Hint = "Enter the vault's master password."
		apierr.Write(w, e)
	case errors.Is(err, vault.ErrNotInitialised):
		apierr.Write(w, apierr.Validation("the vault is not set up yet"))
	case errors.Is(err, vault.ErrExists):
		apierr.Write(w, apierr.Conflict("the vault is already set up"))
	case errors.Is(err, vault.ErrNoSecret):
		apierr.Write(w, apierr.NotFound("no such secret"))
	case errors.Is(err, vault.ErrNoKeyring):
		apierr.Write(w, apierr.NotFound("this device has no remembered vault key"))
	default:
		apierr.Write(w, apierr.Validation(err.Error()))
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

// UnlockKeyring unlocks the vault from the OS-keyring-remembered key (R4d).
func (h *VaultHandlers) UnlockKeyring(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Vault.UnlockWithKeyring(); err != nil {
		vaultErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, h.Vault.Status())
}

// Remember stores the current key in the OS keyring.
func (h *VaultHandlers) Remember(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Vault.Remember(); err != nil {
		vaultErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, h.Vault.Status())
}

// Forget removes the remembered key from the OS keyring.
func (h *VaultHandlers) Forget(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Vault.Forget(); err != nil {
		vaultErr(w, err)
		return
	}
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
		apierr.Write(w, apierr.Validation(err.Error()))
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
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if err := h.Vault.ImportBytes(b.File, b.MasterPassword); err != nil {
		vaultErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, h.Vault.Status())
}
