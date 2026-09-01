package llm

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// ErrNotFound is returned for an unknown connection / task id.
var ErrNotFound = errors.New("not found")

const schema = `
CREATE TABLE IF NOT EXISTS llm_connection (
  id          TEXT PRIMARY KEY,
  conn_json   TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_task (
  id          TEXT PRIMARY KEY,
  task_json   TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`

// migrations are additive ALTERs applied after the base schema. A "duplicate
// column" error means the migration already ran — ignored. USER_MANAGEMENT_PLAN
// U2: owner scoping. owner = '' is a pre-auth / single-user row.
var migrations = []string{
	`ALTER TABLE llm_connection ADD COLUMN owner TEXT NOT NULL DEFAULT ''`,
	`ALTER TABLE llm_task ADD COLUMN owner TEXT NOT NULL DEFAULT ''`,
}

// Store is the llm.db handle.
type Store struct{ db *sql.DB }

// Open opens (creating if needed) llm.db and applies the schema.
func Open(dsn string) (*Store, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	for _, m := range migrations {
		if _, err := db.Exec(m); err != nil && !strings.Contains(err.Error(), "duplicate column") {
			_ = db.Close()
			return nil, fmt.Errorf("migrate (%s): %w", m, err)
		}
	}
	return &Store{db: db}, nil
}

// scopeFilter returns the WHERE fragment + arg that limits a query to a user.
// owner == "" (single-user) matches every row; a real user matches only their
// own rows plus any still-unclaimed (owner = '') rows.
func scopeFilter(owner string) (string, []any) {
	if owner == "" {
		return "", nil
	}
	return " AND (owner = ? OR owner = '')", []any{owner}
}

// ClaimOrphans assigns every unowned row to owner — run once when the first
// admin is created so pre-auth data isn't stranded.
func (s *Store) ClaimOrphans(owner string) error {
	if owner == "" {
		return nil
	}
	for _, t := range []string{"llm_connection", "llm_task"} {
		if _, err := s.db.Exec(`UPDATE `+t+` SET owner = ? WHERE owner = ''`, owner); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Close() error { return s.db.Close() }

// DB exposes the underlying handle so a sibling table (internal/mcp) can share
// llm.db without a second connection pool.
func (s *Store) DB() *sql.DB { return s.db }

// --- connections -----------------------------------------------------

// ListConnections returns the caller's connections, newest first.
func (s *Store) ListConnections(owner string) ([]Connection, error) {
	where, args := scopeFilter(owner)
	rows, err := s.db.Query(`SELECT conn_json FROM llm_connection WHERE 1=1`+where+` ORDER BY created_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Connection{}
	for rows.Next() {
		var j string
		if err := rows.Scan(&j); err != nil {
			return nil, err
		}
		var c Connection
		_ = json.Unmarshal([]byte(j), &c)
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetConnection loads one connection the caller may see.
func (s *Store) GetConnection(owner, id string) (*Connection, error) {
	where, args := scopeFilter(owner)
	var j string
	err := s.db.QueryRow(`SELECT conn_json FROM llm_connection WHERE id = ?`+where, append([]any{id}, args...)...).Scan(&j)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var c Connection
	_ = json.Unmarshal([]byte(j), &c)
	return &c, nil
}

// PutConnection upserts a connection owned by owner.
func (s *Store) PutConnection(owner string, c Connection) (Connection, error) {
	if c.Name == "" {
		return c, errors.New("connection name is required")
	}
	if For(c.Provider) == nil {
		return c, fmt.Errorf("unsupported provider %q", c.Provider)
	}
	if c.ID == "" {
		c.ID = newID("conn")
		c.CreatedAt = time.Now().UnixMilli()
	} else if existing, err := s.GetConnection(owner, c.ID); err == nil && c.CreatedAt == 0 {
		c.CreatedAt = existing.CreatedAt
	} else if err == ErrNotFound {
		return c, ErrNotFound // can't edit someone else's connection
	}
	raw, _ := json.Marshal(c)
	_, err := s.db.Exec(`INSERT INTO llm_connection (id, conn_json, created_at, owner) VALUES (?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET conn_json = excluded.conn_json`, c.ID, string(raw), c.CreatedAt, owner)
	return c, err
}

// DeleteConnection removes one of the caller's connections.
func (s *Store) DeleteConnection(owner, id string) error {
	where, args := scopeFilter(owner)
	res, err := s.db.Exec(`DELETE FROM llm_connection WHERE id = ?`+where, append([]any{id}, args...)...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// --- tasks ---------------------------------------------------------

// customTasks loads the caller's editable rows keyed by id.
func (s *Store) customTasks(owner string) (map[string]Task, error) {
	where, args := scopeFilter(owner)
	rows, err := s.db.Query(`SELECT task_json FROM llm_task WHERE 1=1`+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]Task{}
	for rows.Next() {
		var j string
		if err := rows.Scan(&j); err != nil {
			return nil, err
		}
		var t Task
		if json.Unmarshal([]byte(j), &t) == nil && t.ID != "" {
			out[t.ID] = t
		}
	}
	return out, rows.Err()
}

// ListTasks returns built-ins ∪ custom. A custom row of the same id replaces
// the built-in (flagged Overridden); a custom-only row is Builtin=false.
func (s *Store) ListTasks(owner string) ([]Task, error) {
	custom, err := s.customTasks(owner)
	if err != nil {
		return nil, err
	}
	var out []Task
	seen := map[string]bool{}
	for _, b := range Builtins() {
		seen[b.ID] = true
		if c, ok := custom[b.ID]; ok {
			c.Builtin = true
			c.Overridden = true
			out = append(out, c)
		} else {
			b.Builtin = true
			out = append(out, b)
		}
	}
	for id, c := range custom {
		if !seen[id] {
			c.Builtin = false
			out = append(out, c)
		}
	}
	return out, nil
}

// GetTask resolves a task: a custom row if present, else the built-in.
func (s *Store) GetTask(owner, id string) (*Task, error) {
	custom, err := s.customTasks(owner)
	if err != nil {
		return nil, err
	}
	if c, ok := custom[id]; ok {
		builtin := false
		for _, b := range Builtins() {
			if b.ID == id {
				builtin = true
			}
		}
		c.Builtin = builtin
		c.Overridden = builtin
		return &c, nil
	}
	for _, b := range Builtins() {
		if b.ID == id {
			b.Builtin = true
			return &b, nil
		}
	}
	return nil, ErrNotFound
}

var taskIDRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`)

// PutTask upserts a custom task row (creating an override of a built-in, or a
// brand-new task).
func (s *Store) PutTask(owner string, t Task) (Task, error) {
	t.ID = strings.TrimSpace(t.ID)
	if t.ID == "" || strings.TrimSpace(t.Title) == "" || strings.TrimSpace(t.SystemTemplate) == "" {
		return t, errors.New("task id, title and systemTemplate are required")
	}
	if !taskIDRe.MatchString(t.ID) {
		return t, errors.New("task id may only contain letters, digits, '.', '_' and '-'")
	}
	if t.OutputShape == "" {
		t.OutputShape = OutputText
	}
	t.Builtin = false
	t.Overridden = false
	raw, _ := json.Marshal(t)
	_, err := s.db.Exec(`INSERT INTO llm_task (id, task_json, updated_at, owner) VALUES (?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET task_json = excluded.task_json, updated_at = excluded.updated_at`,
		t.ID, string(raw), time.Now().UnixMilli(), owner)
	return t, err
}

// DeleteTask drops a custom task row. If a built-in of the same id exists the
// task reverts to it; otherwise it is gone.
func (s *Store) DeleteTask(owner, id string) error {
	where, args := scopeFilter(owner)
	res, err := s.db.Exec(`DELETE FROM llm_task WHERE id = ?`+where, append([]any{id}, args...)...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// --- settings -------------------------------------------------------

func (s *Store) GetSettings() map[string]string {
	m := map[string]string{}
	rows, err := s.db.Query(`SELECT key, value FROM llm_settings`)
	if err != nil {
		return m
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if rows.Scan(&k, &v) == nil {
			m[k] = v
		}
	}
	return m
}

func (s *Store) PutSetting(key, value string) error {
	_, err := s.db.Exec(`INSERT INTO llm_settings (key, value) VALUES (?,?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// --- helpers -------------------------------------------------------

func newID(prefix string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(b)
}
