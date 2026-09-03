package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/formstore"
)

// FormHandlers wires /forms*. Only mounted in multi-user mode — the
// single-user client keeps its local name-keyed IStoragePort repo.
// SHARING_PLAN.md SH3.
type FormHandlers struct {
	Store *formstore.Store
}

func (h *FormHandlers) guard(w http.ResponseWriter) bool {
	if h == nil || h.Store == nil {
		apierr.Write(w, apierr.Unavailable("the form store"))
		return false
	}
	return true
}

func formErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, formstore.ErrNotFound), errors.Is(err, formstore.ErrForbidden):
		apierr.Write(w, apierr.NotFound("not found"))
	default:
		apierr.Write(w, apierr.Validation(err.Error()))
	}
}

func (h *FormHandlers) isOwner(r *http.Request, id string) bool {
	me := owner(r)
	o := h.Store.Owner(id)
	return me == "" || o == "" || o == me
}

// List: GET /forms
func (h *FormHandlers) List(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	forms, err := h.Store.List(owner(r))
	if err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"forms": forms})
}

// Get: GET /forms/{id}
func (h *FormHandlers) Get(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	blob, err := h.Store.Get(owner(r), chi.URLParam(r, "id"))
	if err != nil {
		formErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"form": json.RawMessage(blob)})
}

// Save: PUT /forms/{id}   { name, form }
func (h *FormHandlers) Save(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body struct {
		Name string          `json:"name"`
		Form json.RawMessage `json:"form"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&body); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if body.Name == "" || len(body.Form) == 0 {
		apierr.Write(w, apierr.Validation("name and form are required"))
		return
	}
	if err := h.Store.Save(owner(r), chi.URLParam(r, "id"), body.Name, body.Form); err != nil {
		formErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

// Delete: DELETE /forms/{id}
func (h *FormHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Store.Delete(owner(r), chi.URLParam(r, "id")); err != nil {
		formErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Publish: POST /forms/{id}/publish   { published }
func (h *FormHandlers) Publish(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var b struct {
		Published bool `json:"published"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	if err := h.Store.SetPublished(owner(r), chi.URLParam(r, "id"), b.Published); err != nil {
		formErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]bool{"published": b.Published})
}

// --- targeted sharing --------------------------------------------------

// ListShares: GET /forms/{id}/shares
func (h *FormHandlers) ListShares(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	id := chi.URLParam(r, "id")
	me := owner(r)
	if me != "" && h.Store.Owner(id) != me {
		if v, _ := h.Store.SharedAccess(id, me); !v {
			apierr.Write(w, apierr.NotFound("not found"))
			return
		}
	}
	shares, err := h.Store.Shares(id)
	if err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"shares": shares})
}

// PutShare: PUT /forms/{id}/shares/{userId}   { canEdit }
func (h *FormHandlers) PutShare(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	id, uid := chi.URLParam(r, "id"), chi.URLParam(r, "userId")
	if !h.isOwner(r, id) {
		apierr.Write(w, apierr.Permission("only the owner can share this form"))
		return
	}
	if uid == owner(r) {
		apierr.Write(w, apierr.Validation("you already own this form"))
		return
	}
	var body struct {
		CanEdit bool `json:"canEdit"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := h.Store.Grant(id, uid, owner(r), body.CanEdit); err != nil {
		formErr(w, err)
		return
	}
	audit(r, "form_share", id, map[string]any{"grantee": uid, "canEdit": body.CanEdit})
	h.ListShares(w, r)
}

// DeleteShare: DELETE /forms/{id}/shares/{userId}
func (h *FormHandlers) DeleteShare(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	id, uid := chi.URLParam(r, "id"), chi.URLParam(r, "userId")
	if !h.isOwner(r, id) {
		apierr.Write(w, apierr.Permission("only the owner can change sharing"))
		return
	}
	if err := h.Store.Revoke(id, uid); err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}
	audit(r, "form_unshare", id, map[string]any{"grantee": uid})
	h.ListShares(w, r)
}

// Reassign: PATCH /forms/{id}/owner   { ownerId }   (admin only, audited)
func (h *FormHandlers) Reassign(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) || !requireAdmin(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if h.Store.Owner(id) == "" {
		apierr.Write(w, apierr.NotFound("not found"))
		return
	}
	var body struct {
		OwnerID string `json:"ownerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.OwnerID == "" {
		apierr.Write(w, apierr.Validation("ownerId is required"))
		return
	}
	if err := h.Store.SetOwner(id, body.OwnerID); err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}
	audit(r, "form_reassign", id, map[string]any{"newOwner": body.OwnerID})
	WriteJSON(w, http.StatusOK, map[string]string{"status": "reassigned"})
}
