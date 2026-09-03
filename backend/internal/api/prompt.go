package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/promptstore"
)

// PromptHandlers wires /prompts*. Only mounted in multi-user mode — the
// single-user client keeps its local IStoragePort repo. See
// USER_MANAGEMENT_PLAN U4.
type PromptHandlers struct {
	Store *promptstore.Store
}

func (h *PromptHandlers) guard(w http.ResponseWriter) bool {
	if h == nil || h.Store == nil {
		apierr.Write(w, apierr.Unavailable("the prompt store"))
		return false
	}
	return true
}

func promptErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, promptstore.ErrForbidden()):
		apierr.Write(w, apierr.NotFound("not found"))
	default:
		apierr.Write(w, apierr.Validation(err.Error()))
	}
}

// Library: GET /prompts/library
func (h *PromptHandlers) Library(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	folders, prompts, err := h.Store.Library(owner(r))
	if err != nil {
		promptErr(w, err)
		return
	}
	if folders == nil {
		folders = []json.RawMessage{}
	}
	if prompts == nil {
		prompts = []json.RawMessage{}
	}
	WriteJSON(w, http.StatusOK, map[string]any{"folders": folders, "prompts": prompts})
}

// SavePrompt: PUT /prompts/{id}  (body = the full Prompt blob)
func (h *PromptHandlers) SavePrompt(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var blob json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&blob); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	id := chi.URLParam(r, "id")
	if bid, err := promptstore.IDOf(blob); err == nil && bid != "" {
		id = bid
	}
	if err := h.Store.SavePrompt(owner(r), id, blob); err != nil {
		promptErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"id": id})
}

// DeletePrompt: DELETE /prompts/{id}
func (h *PromptHandlers) DeletePrompt(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Store.DeletePrompt(owner(r), chi.URLParam(r, "id")); err != nil {
		promptErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Publish: POST /prompts/{id}/publish  { published }
func (h *PromptHandlers) Publish(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var b struct {
		Published bool `json:"published"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	if err := h.Store.SetPublished(owner(r), chi.URLParam(r, "id"), b.Published); err != nil {
		promptErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]bool{"published": b.Published})
}

// --- targeted sharing (SHARING_PLAN.md SH2) ------------------------

func (h *PromptHandlers) isPromptOwner(r *http.Request, id string) bool {
	me := owner(r)
	o := h.Store.PromptOwner(id)
	return me == "" || o == "" || o == me
}

// ListShares: GET /prompts/{id}/shares
func (h *PromptHandlers) ListShares(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	id := chi.URLParam(r, "id")
	me := owner(r)
	if me != "" && h.Store.PromptOwner(id) != me {
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

// PutShare: PUT /prompts/{id}/shares/{userId}   { canEdit }
func (h *PromptHandlers) PutShare(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	id, uid := chi.URLParam(r, "id"), chi.URLParam(r, "userId")
	if !h.isPromptOwner(r, id) {
		apierr.Write(w, apierr.Permission("only the owner can share this prompt"))
		return
	}
	if uid == owner(r) {
		apierr.Write(w, apierr.Validation("you already own this prompt"))
		return
	}
	var body struct {
		CanEdit bool `json:"canEdit"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := h.Store.Grant(id, uid, owner(r), body.CanEdit); err != nil {
		promptErr(w, err)
		return
	}
	audit(r, "prompt_share", id, map[string]any{"grantee": uid, "canEdit": body.CanEdit})
	h.ListShares(w, r)
}

// DeleteShare: DELETE /prompts/{id}/shares/{userId}
func (h *PromptHandlers) DeleteShare(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	id, uid := chi.URLParam(r, "id"), chi.URLParam(r, "userId")
	if !h.isPromptOwner(r, id) {
		apierr.Write(w, apierr.Permission("only the owner can change sharing"))
		return
	}
	if err := h.Store.Revoke(id, uid); err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}
	audit(r, "prompt_unshare", id, map[string]any{"grantee": uid})
	h.ListShares(w, r)
}

// Reassign: PATCH /prompts/{id}/owner   { ownerId }   (admin only, audited)
func (h *PromptHandlers) Reassign(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) || !requireAdmin(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if h.Store.PromptOwner(id) == "" {
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
	audit(r, "prompt_reassign", id, map[string]any{"newOwner": body.OwnerID})
	WriteJSON(w, http.StatusOK, map[string]string{"status": "reassigned"})
}

// SaveFolder: PUT /prompts/folders/{id}  (body = Folder blob)
func (h *PromptHandlers) SaveFolder(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var blob json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&blob); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	id := chi.URLParam(r, "id")
	if bid, err := promptstore.IDOf(blob); err == nil && bid != "" {
		id = bid
	}
	if err := h.Store.SaveFolder(owner(r), id, blob); err != nil {
		promptErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"id": id})
}

// DeleteFolder: DELETE /prompts/folders/{id}?orphan=unfiled|delete
func (h *PromptHandlers) DeleteFolder(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	orphanDelete := r.URL.Query().Get("orphan") == "delete"
	if err := h.Store.DeleteFolder(owner(r), chi.URLParam(r, "id"), orphanDelete); err != nil {
		promptErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Templates: GET /prompts/templates
func (h *PromptHandlers) Templates(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	t, err := h.Store.Templates(owner(r))
	if err != nil {
		promptErr(w, err)
		return
	}
	if t == nil {
		t = []json.RawMessage{}
	}
	WriteJSON(w, http.StatusOK, map[string]any{"templates": t})
}

// SaveTemplate: PUT /prompts/templates/{id}  (body = SeedTemplate blob)
func (h *PromptHandlers) SaveTemplate(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var blob json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&blob); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	id := chi.URLParam(r, "id")
	if bid, err := promptstore.IDOf(blob); err == nil && bid != "" {
		id = bid
	}
	if err := h.Store.SaveTemplate(owner(r), id, blob); err != nil {
		promptErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"id": id})
}

// DeleteTemplate: DELETE /prompts/templates/{id}
func (h *PromptHandlers) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Store.DeleteTemplate(owner(r), chi.URLParam(r, "id")); err != nil {
		promptErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
