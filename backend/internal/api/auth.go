package api

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/auth"
	"github.com/infrakit/backend/internal/userctx"
)

// AuthHandlers wires /auth*, /users* and /audit. Only mounted when the backend
// runs with --auth on. See USER_MANAGEMENT_PLAN.md U0.
type AuthHandlers struct {
	Service *auth.Service
	// UserOf resolves the authenticated user from a request context. Set by
	// the server package to server.UserFrom (keeps api from importing server).
	UserOf func(*http.Request) *auth.User
}

func (h *AuthHandlers) me(r *http.Request) *auth.User {
	if h.UserOf == nil {
		return nil
	}
	return h.UserOf(r)
}

// owner returns the calling user's id for per-user data scoping (U2). "" in
// single-user mode → the store treats it as "all rows".
func owner(r *http.Request) string { return userctx.From(r.Context()) }

func clientIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

func authErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrInvalidCredentials), errors.Is(err, auth.ErrBadSetupToken):
		apierr.Write(w, apierr.Auth("invalid credentials"))
	case errors.Is(err, auth.ErrLockedOut):
		apierr.Write(w, apierr.RateLimited("too many attempts — wait a few minutes"))
	case errors.Is(err, auth.ErrDisabled):
		apierr.Write(w, apierr.Permission("this account is disabled"))
	case errors.Is(err, auth.ErrNotFound):
		apierr.Write(w, apierr.NotFound("no such user"))
	case errors.Is(err, auth.ErrTaken):
		apierr.Write(w, apierr.Conflict("that username is taken"))
	case errors.Is(err, auth.ErrBootstrapDone):
		apierr.Write(w, apierr.Conflict("already initialised — sign in instead"))
	case errors.Is(err, auth.ErrLastAdmin):
		apierr.Write(w, apierr.Validation("cannot remove or demote the last admin"))
	case errors.Is(err, auth.ErrWeakPassword):
		apierr.Write(w, apierr.Validation("password must be at least 10 characters"))
	default:
		apierr.Write(w, apierr.Internal(err.Error()))
	}
}

// SetupStatus: GET /auth/setup-status → { needsBootstrap }
func (h *AuthHandlers) SetupStatus(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]bool{"needsBootstrap": h.Service.NeedsBootstrap()})
}

// Bootstrap: POST /auth/bootstrap { token, username, password }
func (h *AuthHandlers) Bootstrap(w http.ResponseWriter, r *http.Request) {
	var b struct{ Token, Username, Password string }
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	sess, u, err := h.Service.Bootstrap(b.Token, b.Username, b.Password, r.UserAgent())
	if err != nil {
		authErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"token": sess, "user": u})
}

// Login: POST /auth/login { username, password }
func (h *AuthHandlers) Login(w http.ResponseWriter, r *http.Request) {
	var b struct{ Username, Password string }
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	sess, u, err := h.Service.Login(b.Username, b.Password, clientIP(r), r.UserAgent())
	if err != nil {
		authErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"token": sess, "user": u})
}

// Logout: POST /auth/logout
func (h *AuthHandlers) Logout(w http.ResponseWriter, r *http.Request) {
	tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	_ = h.Service.Logout(tok, h.me(r))
	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Me: GET /auth/me → the current user
func (h *AuthHandlers) Me(w http.ResponseWriter, r *http.Request) {
	u := h.me(r)
	if u == nil {
		apierr.Write(w, apierr.Auth("not signed in"))
		return
	}
	WriteJSON(w, http.StatusOK, u)
}

// ChangePassword: POST /auth/change-password { current, next } → { token }
func (h *AuthHandlers) ChangePassword(w http.ResponseWriter, r *http.Request) {
	u := h.me(r)
	if u == nil {
		apierr.Write(w, apierr.Auth("not signed in"))
		return
	}
	var b struct{ Current, Next string }
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	sess, err := h.Service.ChangePassword(u, b.Current, b.Next, r.UserAgent())
	if err != nil {
		authErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"token": sess})
}

// --- admin: /users, /audit ------------------------------------------

func (h *AuthHandlers) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	u := h.me(r)
	if u == nil || u.Role != auth.RoleAdmin {
		apierr.Write(w, apierr.Permission("admin only"))
		return false
	}
	return true
}

// ListUsers: GET /users
func (h *AuthHandlers) ListUsers(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	list, err := h.Service.Store().ListUsers()
	if err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"users": list})
}

// CreateUser: POST /users { username, email?, password, role }
func (h *AuthHandlers) CreateUser(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var b struct {
		Username, Email, Password string
		Role                     auth.Role
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if b.Role == "" {
		b.Role = auth.RoleOperator
	}
	u, err := h.Service.Store().CreateUser(strings.TrimSpace(b.Username), b.Email, b.Password, b.Role)
	if err != nil {
		authErr(w, err)
		return
	}
	h.Service.Audit(h.me(r), "user_create", u.Username, map[string]string{"role": string(u.Role)})
	WriteJSON(w, http.StatusOK, u)
}

// PatchUser: PATCH /users/{id} { email?, role?, allowedModules?, disabled?, password?, mustChangePw? }
func (h *AuthHandlers) PatchUser(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var b struct {
		Email          *string    `json:"email"`
		Role           *auth.Role `json:"role"`
		AllowedModules *[]string  `json:"allowedModules"`
		Disabled       *bool      `json:"disabled"`
		Password       *string    `json:"password"`
		MustChangePw   *bool      `json:"mustChangePw"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	u, err := h.Service.Store().UpdateUser(chi.URLParam(r, "id"), auth.UserPatch{
		Email: b.Email, Role: b.Role, AllowedModules: b.AllowedModules,
		Disabled: b.Disabled, Password: b.Password, MustChangePw: b.MustChangePw,
	})
	if err != nil {
		authErr(w, err)
		return
	}
	h.Service.Audit(h.me(r), "user_update", u.Username, nil)
	WriteJSON(w, http.StatusOK, u)
}

// DeleteUser: DELETE /users/{id}
func (h *AuthHandlers) DeleteUser(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if err := h.Service.Store().DeleteUser(id); err != nil {
		authErr(w, err)
		return
	}
	h.Service.Audit(h.me(r), "user_delete", id, nil)
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ListAudit: GET /audit?limit=200
func (h *AuthHandlers) ListAudit(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	entries, err := h.Service.Store().ListAudit(atoiOr(r.URL.Query().Get("limit"), 200))
	if err != nil {
		apierr.Write(w, apierr.Internal(err.Error()))
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"entries": entries})
}
