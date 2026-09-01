package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

// Service is the identity layer handlers talk to. It is only constructed when
// the backend runs with --auth on.
type Service struct {
	store *Store
	thr   *throttle

	setupMu    sync.Mutex
	setupToken string // one-time; set at construction iff no users exist

	// OnBootstrap, if set, runs with the new admin's id right after the first
	// account is created — used to claim pre-auth data (U2). Best-effort.
	OnBootstrap func(adminID string)
}

// NewService wires a Service over an open auth.db. If the store has no users
// yet, a one-time setup token is generated for /auth/bootstrap; the caller
// should print it (once) so an operator can create the first admin.
func NewService(store *Store) (*Service, error) {
	s := &Service{store: store, thr: newThrottle()}
	n, err := store.CountUsers()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		b := make([]byte, 24)
		if _, err := rand.Read(b); err != nil {
			return nil, err
		}
		s.setupToken = hex.EncodeToString(b)
	}
	go s.housekeep()
	return s, nil
}

func (s *Service) housekeep() {
	t := time.NewTicker(30 * time.Minute)
	defer t.Stop()
	for range t.C {
		_ = s.store.PruneExpiredSessions()
		s.thr.sweep()
	}
}

// SetupToken returns the pending one-time bootstrap token, or "" if the
// instance is already initialised.
func (s *Service) SetupToken() string {
	s.setupMu.Lock()
	defer s.setupMu.Unlock()
	return s.setupToken
}

// NeedsBootstrap reports whether no admin exists yet.
func (s *Service) NeedsBootstrap() bool { return s.SetupToken() != "" }

// Bootstrap consumes the setup token and creates the first admin, returning a
// session token for immediate login.
func (s *Service) Bootstrap(token, username, password, userAgent string) (string, *User, error) {
	s.setupMu.Lock()
	defer s.setupMu.Unlock()
	if s.setupToken == "" {
		return "", nil, ErrBootstrapDone
	}
	if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(token)), []byte(s.setupToken)) != 1 {
		return "", nil, ErrBadSetupToken
	}
	u, err := s.store.CreateUser(strings.TrimSpace(username), "", password, RoleAdmin)
	if err != nil {
		return "", nil, err
	}
	s.setupToken = "" // spent
	if s.OnBootstrap != nil {
		s.OnBootstrap(u.ID)
	}
	sess, err := s.store.CreateSession(u.ID, userAgent)
	if err != nil {
		return "", nil, err
	}
	_ = s.store.AddAudit(AuditEntry{UserID: u.ID, Actor: u.Username, Action: "bootstrap", Target: u.Username})
	return sess, u, nil
}

// Login verifies credentials (with per-key backoff) and issues a session.
// `key` is a throttle key — pass "<username>|<client-ip>".
func (s *Service) Login(username, password, clientIP, userAgent string) (string, *User, error) {
	username = strings.TrimSpace(username)
	key := username + "|" + clientIP
	if !s.thr.allowed(key) {
		return "", nil, ErrLockedOut
	}
	u, err := s.store.GetUserByName(username)
	if err != nil || !verifyPassword(password, u.passwordHash) {
		s.thr.fail(key)
		// audit the failure without leaking whether the username exists
		_ = s.store.AddAudit(AuditEntry{Actor: username, Action: "login_failed", Meta: jsonMeta(map[string]string{"ip": clientIP})})
		return "", nil, ErrInvalidCredentials
	}
	if u.Disabled {
		s.thr.fail(key)
		return "", nil, ErrDisabled
	}
	s.thr.ok(key)
	sess, err := s.store.CreateSession(u.ID, userAgent)
	if err != nil {
		return "", nil, err
	}
	_ = s.store.AddAudit(AuditEntry{UserID: u.ID, Actor: u.Username, Action: "login", Meta: jsonMeta(map[string]string{"ip": clientIP})})
	return sess, u, nil
}

// Validate resolves a session token to its user, sliding the expiry.
func (s *Service) Validate(token string) (*User, error) {
	_, u, err := s.store.LookupSession(token)
	return u, err
}

// Logout revokes one session.
func (s *Service) Logout(token string, actor *User) error {
	if actor != nil {
		_ = s.store.AddAudit(AuditEntry{UserID: actor.ID, Actor: actor.Username, Action: "logout"})
	}
	return s.store.DeleteSession(token)
}

// ChangePassword updates the caller's own password. Every existing session
// (including the one that made this request) is revoked; a fresh session token
// is returned so the client stays logged in without a round-trip to /login.
func (s *Service) ChangePassword(u *User, current, next, userAgent string) (string, error) {
	full, err := s.store.GetUser(u.ID)
	if err != nil {
		return "", err
	}
	if !verifyPassword(current, full.passwordHash) {
		return "", ErrInvalidCredentials
	}
	if len(next) < minPasswordLen {
		return "", ErrWeakPassword
	}
	mc := false
	if _, err := s.store.UpdateUser(u.ID, UserPatch{Password: &next, MustChangePw: &mc}); err != nil {
		return "", err
	}
	// UpdateUser wiped every session — mint a new one for the caller.
	sess, err := s.store.CreateSession(u.ID, userAgent)
	if err != nil {
		return "", err
	}
	_ = s.store.AddAudit(AuditEntry{UserID: u.ID, Actor: u.Username, Action: "password_change"})
	return sess, nil
}

// Store exposes the underlying store for the admin handlers.
func (s *Service) Store() *Store { return s.store }

// Audit is a convenience passthrough for other packages via the api layer.
func (s *Service) Audit(actor *User, action, target string, meta any) {
	e := AuditEntry{Action: action, Target: target, Meta: jsonMeta(meta)}
	if actor != nil {
		e.UserID = actor.ID
		e.Actor = actor.Username
	}
	_ = s.store.AddAudit(e)
}
