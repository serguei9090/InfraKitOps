package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/userctx"
	"github.com/infrakit/backend/internal/vault"
)

// VaultHandlers wires /vault*. Nil Reg → 503. Each request acts on the
// calling user's vault (U2); single-user mode → the one shared vault.
type VaultHandlers struct {
	Reg *vault.Registry
}

func (h *VaultHandlers) guard(w http.ResponseWriter) bool {
	if h == nil || h.Reg == nil {
		apierr.Write(w, apierr.Unavailable("the vault"))
		return false
	}
	return true
}

// v returns the vault for the request's user ("" in single-user mode).
func (h *VaultHandlers) v(r *http.Request) *vault.Vault {
	return h.Reg.For(userctx.From(r.Context()))
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

func (h *VaultHandlers) Status(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	WriteJSON(w, http.StatusOK, h.v(r).Status())
}

func (h *VaultHandlers) Init(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var b struct {
		MasterPassword string `json:"masterPassword"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	if err := h.v(r).Init(b.MasterPassword); err != nil {
		vaultErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, h.v(r).Status())
}

func (h *VaultHandlers) Unlock(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var b struct {
		MasterPassword string `json:"masterPassword"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	if err := h.v(r).Unlock(b.MasterPassword); err != nil {
		vaultErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, h.v(r).Status())
}

func (h *VaultHandlers) Lock(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	h.v(r).Lock()
	WriteJSON(w, http.StatusOK, h.v(r).Status())
}

// UnlockKeyring unlocks the vault from the OS-keyring-remembered key (R4d).
func (h *VaultHandlers) UnlockKeyring(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.v(r).UnlockWithKeyring(); err != nil {
		vaultErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, h.v(r).Status())
}

// Remember stores the current key in the OS keyring.
func (h *VaultHandlers) Remember(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.v(r).Remember(); err != nil {
		vaultErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, h.v(r).Status())
}

// Forget removes the remembered key from the OS keyring.
func (h *VaultHandlers) Forget(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.v(r).Forget(); err != nil {
		vaultErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, h.v(r).Status())
}

func (h *VaultHandlers) ListSecrets(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"secrets": h.v(r).List()})
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
	id, err := h.v(r).Put(chi.URLParam(r, "id"), b.Name, kind, b.Notes, b.Value)
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
	if err := h.v(r).Delete(chi.URLParam(r, "id")); err != nil {
		vaultErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *VaultHandlers) Export(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	b, err := h.v(r).ExportBytes()
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
	if err := h.v(r).ImportBytes(b.File, b.MasterPassword); err != nil {
		vaultErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, h.v(r).Status())
}
