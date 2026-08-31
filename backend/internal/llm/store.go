package llm

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
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
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

// --- connections -----------------------------------------------------

// ListConnections returns every connection, newest first.
func (s *Store) ListConnections() ([]Connection, error) {
	rows, err := s.db.Query(`SELECT conn_json FROM llm_connection ORDER BY created_at DESC`)
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

// GetConnection loads one connection.
func (s *Store) GetConnection(id string) (*Connection, error) {
	var j string
	err := s.db.QueryRow(`SELECT conn_json FROM llm_connection WHERE id = ?`, id).Scan(&j)
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

// PutConnection upserts a connection.
func (s *Store) PutConnection(c Connection) (Connection, error) {
	if c.Name == "" {
		return c, errors.New("connection name is required")
	}
	if For(c.Provider) == nil {
		return c, fmt.Errorf("unsupported provider %q", c.Provider)
	}
	if c.ID == "" {
		c.ID = newID("conn")
		c.CreatedAt = time.Now().UnixMilli()
	} else if existing, err := s.GetConnection(c.ID); err == nil && c.CreatedAt == 0 {
		c.CreatedAt = existing.CreatedAt
	}
	raw, _ := json.Marshal(c)
	_, err := s.db.Exec(`INSERT INTO llm_connection (id, conn_json, created_at) VALUES (?,?,?)
		ON CONFLICT(id) DO UPDATE SET conn_json = excluded.conn_json`, c.ID, string(raw), c.CreatedAt)
	return c, err
}

// DeleteConnection removes a connection.
func (s *Store) DeleteConnection(id string) error {
	res, err := s.db.Exec(`DELETE FROM llm_connection WHERE id = ?`, id)
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
