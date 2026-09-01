// Package auth is the identity layer for multi-user mode (USER_MANAGEMENT_PLAN.md).
// It is inert unless the backend is started with --auth on: then every
// /api/v1 request (except /health and /auth/{login,bootstrap}) needs a valid
// session, and users/roles/audit are stored in auth.db.
package auth

import "errors"

var (
	// ErrNotFound is an unknown user or session id.
	ErrNotFound = errors.New("not found")
	// ErrInvalidCredentials is a wrong username/password (kept vague on purpose).
	ErrInvalidCredentials = errors.New("invalid credentials")
	// ErrLockedOut is returned while a username/IP is in login backoff.
	ErrLockedOut = errors.New("too many attempts — try again later")
	// ErrDisabled is a valid password for a disabled account.
	ErrDisabled = errors.New("account disabled")
	// ErrTaken is a username collision on create.
	ErrTaken = errors.New("username already taken")
	// ErrBootstrapDone is returned when /auth/bootstrap runs after the first user exists.
	ErrBootstrapDone = errors.New("already initialised")
	// ErrBadSetupToken is a wrong or spent setup token.
	ErrBadSetupToken = errors.New("bad setup token")
	// ErrLastAdmin blocks removing/demoting/disabling the only admin.
	ErrLastAdmin = errors.New("cannot remove the last admin")
	// ErrWeakPassword is a password under the minimum length.
	ErrWeakPassword = errors.New("password too short (min 10 characters)")
)

// Role is the coarse permission tier. Module-level access is layered on top
// via User.AllowedModules (U5).
type Role string

const (
	RoleAdmin    Role = "admin"    // manage users, read audit, everything else
	RoleOperator Role = "operator" // run + write everything
	RoleViewer   Role = "viewer"   // read-only
)

func (r Role) Valid() bool {
	switch r {
	case RoleAdmin, RoleOperator, RoleViewer:
		return true
	}
	return false
}

// CanWrite reports whether the role may perform mutating requests.
func (r Role) CanWrite() bool { return r == RoleAdmin || r == RoleOperator }

const minPasswordLen = 10

// User is an account. PasswordHash is never serialised to the API.
type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email,omitempty"`
	Role     Role   `json:"role"`
	// AllowedModules restricts which rail modules this user sees. nil = all
	// (the role's default). Enforced by moduleGuard + the frontend (U5).
	AllowedModules []string `json:"allowedModules,omitempty"`
	Disabled       bool     `json:"disabled"`
	MustChangePw   bool     `json:"mustChangePw"`
	CreatedAt      int64    `json:"createdAt"`
	UpdatedAt      int64    `json:"updatedAt"`

	passwordHash string
}

// Session is an issued login. Token is only known to the client; the store
// keeps sha256(token).
type Session struct {
	UserID     string `json:"userId"`
	CreatedAt  int64  `json:"createdAt"`
	ExpiresAt  int64  `json:"expiresAt"`
	LastSeenAt int64  `json:"lastSeenAt"`
	UserAgent  string `json:"userAgent,omitempty"`
}

// AuditEntry is one append-only audit record.
type AuditEntry struct {
	ID     int64  `json:"id"`
	At     int64  `json:"at"`
	UserID string `json:"userId,omitempty"`
	Actor  string `json:"actor,omitempty"` // username, denormalised for display
	Action string `json:"action"`
	Target string `json:"target,omitempty"`
	Meta   string `json:"meta,omitempty"`
}
