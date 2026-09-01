package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS auth_user (
  id              TEXT PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,
  email           TEXT NOT NULL DEFAULT '',
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL,
  allowed_modules TEXT NOT NULL DEFAULT '',
  disabled        INTEGER NOT NULL DEFAULT 0,
  must_change_pw  INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_session (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS auth_session_user ON auth_session(user_id);
CREATE TABLE IF NOT EXISTS auth_audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  actor   TEXT NOT NULL DEFAULT '',
  action  TEXT NOT NULL,
  target  TEXT NOT NULL DEFAULT '',
  meta    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS auth_audit_at ON auth_audit(at DESC);
`

// Store is the auth.db handle.
type Store struct{ db *sql.DB }

// Open opens (creating if needed) auth.db and applies the schema.
func Open(dsn string) (*Store, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply auth schema: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func newUserID() string {
	b := make([]byte, 9)
	_, _ = rand.Read(b)
	return "usr_" + base64.RawURLEncoding.EncodeToString(b)
}

func hashToken(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

// --- users -----------------------------------------------------------

func scanUser(row interface{ Scan(...any) error }) (*User, error) {
	var u User
	var mods string
	if err := row.Scan(
		&u.ID, &u.Username, &u.Email, &u.passwordHash, &u.Role,
		&mods, &u.Disabled, &u.MustChangePw, &u.CreatedAt, &u.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if mods != "" {
		u.AllowedModules = strings.Split(mods, ",")
	}
	return &u, nil
}

const userCols = `id, username, email, password_hash, role, allowed_modules, disabled, must_change_pw, created_at, updated_at`

// CountUsers reports how many accounts exist (0 → needs bootstrap).
func (s *Store) CountUsers() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM auth_user`).Scan(&n)
	return n, err
}

func (s *Store) countAdmins(exclude string) (int, error) {
	var n int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM auth_user WHERE role = ? AND disabled = 0 AND id != ?`,
		RoleAdmin, exclude,
	).Scan(&n)
	return n, err
}

// CreateUser inserts a new account. pw is plaintext; it is hashed here.
func (s *Store) CreateUser(username, email, pw string, role Role) (*User, error) {
	if len(pw) < minPasswordLen {
		return nil, ErrWeakPassword
	}
	if !role.Valid() {
		return nil, fmt.Errorf("bad role %q", role)
	}
	h, err := hashPassword(pw)
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	u := &User{
		ID: newUserID(), Username: username, Email: email, Role: role,
		CreatedAt: now, UpdatedAt: now, passwordHash: h,
	}
	_, err = s.db.Exec(
		`INSERT INTO auth_user (`+userCols+`) VALUES (?,?,?,?,?,?,?,?,?,?)`,
		u.ID, u.Username, u.Email, u.passwordHash, u.Role, "", 0, 0, u.CreatedAt, u.UpdatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return nil, ErrTaken
		}
		return nil, err
	}
	return u, nil
}

func (s *Store) GetUser(id string) (*User, error) {
	u, err := scanUser(s.db.QueryRow(`SELECT `+userCols+` FROM auth_user WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return u, err
}

func (s *Store) GetUserByName(username string) (*User, error) {
	u, err := scanUser(s.db.QueryRow(`SELECT `+userCols+` FROM auth_user WHERE username = ?`, username))
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return u, err
}

func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query(`SELECT ` + userCols + ` FROM auth_user ORDER BY username`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

// UserPatch is the set of mutable fields; nil pointers are left unchanged.
type UserPatch struct {
	Email          *string
	Role           *Role
	AllowedModules *[]string
	Disabled       *bool
	Password       *string // plaintext; re-hashed
	MustChangePw   *bool
}

// UpdateUser applies a patch. Guards against removing the last admin.
func (s *Store) UpdateUser(id string, p UserPatch) (*User, error) {
	u, err := s.GetUser(id)
	if err != nil {
		return nil, err
	}
	// last-admin protection: demote or disable of the only admin is refused
	losingAdmin := (p.Role != nil && *p.Role != RoleAdmin && u.Role == RoleAdmin) ||
		(p.Disabled != nil && *p.Disabled && u.Role == RoleAdmin)
	if losingAdmin {
		if n, err := s.countAdmins(id); err != nil {
			return nil, err
		} else if n == 0 {
			return nil, ErrLastAdmin
		}
	}
	if p.Email != nil {
		u.Email = *p.Email
	}
	if p.Role != nil {
		if !p.Role.Valid() {
			return nil, fmt.Errorf("bad role %q", *p.Role)
		}
		u.Role = *p.Role
	}
	if p.AllowedModules != nil {
		u.AllowedModules = *p.AllowedModules
	}
	if p.Disabled != nil {
		u.Disabled = *p.Disabled
	}
	if p.MustChangePw != nil {
		u.MustChangePw = *p.MustChangePw
	}
	if p.Password != nil {
		if len(*p.Password) < minPasswordLen {
			return nil, ErrWeakPassword
		}
		h, err := hashPassword(*p.Password)
		if err != nil {
			return nil, err
		}
		u.passwordHash = h
	}
	u.UpdatedAt = time.Now().UnixMilli()
	_, err = s.db.Exec(
		`UPDATE auth_user SET email=?, password_hash=?, role=?, allowed_modules=?, disabled=?, must_change_pw=?, updated_at=? WHERE id=?`,
		u.Email, u.passwordHash, u.Role, strings.Join(u.AllowedModules, ","),
		b2i(u.Disabled), b2i(u.MustChangePw), u.UpdatedAt, u.ID,
	)
	if err != nil {
		return nil, err
	}
	// a disabled / re-credentialed user loses every live session
	if (p.Disabled != nil && *p.Disabled) || p.Password != nil {
		_ = s.DeleteUserSessions(u.ID)
	}
	return u, nil
}

// DeleteUser removes an account (and its sessions). Refuses the last admin.
func (s *Store) DeleteUser(id string) error {
	u, err := s.GetUser(id)
	if err != nil {
		return err
	}
	if u.Role == RoleAdmin {
		if n, err := s.countAdmins(id); err != nil {
			return err
		} else if n == 0 {
			return ErrLastAdmin
		}
	}
	_ = s.DeleteUserSessions(id)
	_, err = s.db.Exec(`DELETE FROM auth_user WHERE id = ?`, id)
	return err
}

// --- sessions --------------------------------------------------------

const sessionTTL = 14 * 24 * time.Hour

// CreateSession issues a token for a user and returns the plaintext token.
func (s *Store) CreateSession(userID, userAgent string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	tok := "sess_" + base64.RawURLEncoding.EncodeToString(raw)
	now := time.Now()
	_, err := s.db.Exec(
		`INSERT INTO auth_session (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent)
		 VALUES (?,?,?,?,?,?)`,
		hashToken(tok), userID, now.UnixMilli(), now.Add(sessionTTL).UnixMilli(), now.UnixMilli(), userAgent,
	)
	return tok, err
}

// LookupSession validates a token, slides its expiry, and returns the session +
// its user. Expired or unknown → ErrNotFound.
func (s *Store) LookupSession(tok string) (*Session, *User, error) {
	th := hashToken(tok)
	var sess Session
	err := s.db.QueryRow(
		`SELECT user_id, created_at, expires_at, last_seen_at, user_agent FROM auth_session WHERE token_hash = ?`, th,
	).Scan(&sess.UserID, &sess.CreatedAt, &sess.ExpiresAt, &sess.LastSeenAt, &sess.UserAgent)
	if err == sql.ErrNoRows {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	now := time.Now()
	if now.UnixMilli() > sess.ExpiresAt {
		_, _ = s.db.Exec(`DELETE FROM auth_session WHERE token_hash = ?`, th)
		return nil, nil, ErrNotFound
	}
	u, err := s.GetUser(sess.UserID)
	if err != nil {
		return nil, nil, err
	}
	if u.Disabled {
		return nil, nil, ErrDisabled
	}
	sess.ExpiresAt = now.Add(sessionTTL).UnixMilli()
	sess.LastSeenAt = now.UnixMilli()
	_, _ = s.db.Exec(
		`UPDATE auth_session SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?`,
		sess.ExpiresAt, sess.LastSeenAt, th,
	)
	return &sess, u, nil
}

func (s *Store) DeleteSession(tok string) error {
	_, err := s.db.Exec(`DELETE FROM auth_session WHERE token_hash = ?`, hashToken(tok))
	return err
}

func (s *Store) DeleteUserSessions(userID string) error {
	_, err := s.db.Exec(`DELETE FROM auth_session WHERE user_id = ?`, userID)
	return err
}

// PruneExpiredSessions clears stale rows; call periodically.
func (s *Store) PruneExpiredSessions() error {
	_, err := s.db.Exec(`DELETE FROM auth_session WHERE expires_at < ?`, time.Now().UnixMilli())
	return err
}

// --- audit ----------------------------------------------------------

func (s *Store) AddAudit(e AuditEntry) error {
	_, err := s.db.Exec(
		`INSERT INTO auth_audit (at, user_id, actor, action, target, meta) VALUES (?,?,?,?,?,?)`,
		time.Now().UnixMilli(), e.UserID, e.Actor, e.Action, e.Target, e.Meta,
	)
	return err
}

// ListAudit returns the newest entries, up to limit (default 200, max 1000).
func (s *Store) ListAudit(limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	rows, err := s.db.Query(
		`SELECT id, at, user_id, actor, action, target, meta FROM auth_audit ORDER BY id DESC LIMIT ?`, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.ID, &e.At, &e.UserID, &e.Actor, &e.Action, &e.Target, &e.Meta); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// jsonMeta is a tiny helper for audit meta payloads.
func jsonMeta(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}
