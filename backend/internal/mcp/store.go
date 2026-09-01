package mcp

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const schema = `
CREATE TABLE IF NOT EXISTS mcp_server (
  id          TEXT PRIMARY KEY,
  cfg_json    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
`

// U2 — owner scoping. "" = pre-auth / single-user row.
var migrations = []string{
	`ALTER TABLE mcp_server ADD COLUMN owner TEXT NOT NULL DEFAULT ''`,
}

// Store persists the MCP server registry. It shares llm.db — pass the handle
// from llm.Store.DB().
type Store struct{ db *sql.DB }

// NewStore applies the mcp_server schema on the given DB handle.
func NewStore(db *sql.DB) (*Store, error) {
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("apply mcp schema: %w", err)
	}
	for _, m := range migrations {
		if _, err := db.Exec(m); err != nil && !strings.Contains(err.Error(), "duplicate column") {
			return nil, fmt.Errorf("mcp migration %q: %w", m, err)
		}
	}
	return &Store{db: db}, nil
}

func scopeFilter(owner string) (string, []any) {
	if owner == "" {
		return "", nil
	}
	return " AND (owner = ? OR owner = '')", []any{owner}
}

// ClaimOrphans assigns unowned servers to owner (first-admin bootstrap).
func (s *Store) ClaimOrphans(owner string) error {
	if owner == "" {
		return nil
	}
	_, err := s.db.Exec(`UPDATE mcp_server SET owner = ? WHERE owner = ''`, owner)
	return err
}

// List returns the caller's servers, newest first.
func (s *Store) List(owner string) ([]ServerConfig, error) {
	where, args := scopeFilter(owner)
	rows, err := s.db.Query(`SELECT cfg_json FROM mcp_server WHERE 1=1`+where+` ORDER BY created_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ServerConfig{}
	for rows.Next() {
		var j string
		if err := rows.Scan(&j); err != nil {
			return nil, err
		}
		var c ServerConfig
		if err := json.Unmarshal([]byte(j), &c); err == nil {
			out = append(out, c)
		}
	}
	return out, rows.Err()
}

// Get loads one server the caller may see.
func (s *Store) Get(owner, id string) (*ServerConfig, error) {
	where, args := scopeFilter(owner)
	var j string
	err := s.db.QueryRow(`SELECT cfg_json FROM mcp_server WHERE id = ?`+where, append([]any{id}, args...)...).Scan(&j)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var c ServerConfig
	if err := json.Unmarshal([]byte(j), &c); err != nil {
		return nil, err
	}
	return &c, nil
}

// Put inserts or updates a server owned by owner, returning its id.
func (s *Store) Put(owner string, c ServerConfig) (string, error) {
	if err := c.Validate(); err != nil {
		return "", err
	}
	if c.ID == "" {
		c.ID = newID()
		c.CreatedAt = time.Now().UnixMilli()
	} else if existing, err := s.Get(owner, c.ID); err == nil {
		if c.CreatedAt == 0 {
			c.CreatedAt = existing.CreatedAt
		}
	} else if err == ErrNotFound {
		return "", ErrNotFound // not the caller's server
	} else {
		c.CreatedAt = time.Now().UnixMilli()
	}
	j, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	_, err = s.db.Exec(
		`INSERT INTO mcp_server (id, cfg_json, created_at, owner) VALUES (?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET cfg_json = excluded.cfg_json`,
		c.ID, string(j), c.CreatedAt, owner,
	)
	return c.ID, err
}

// Delete removes one of the caller's servers.
func (s *Store) Delete(owner, id string) error {
	where, args := scopeFilter(owner)
	res, err := s.db.Exec(`DELETE FROM mcp_server WHERE id = ?`+where, append([]any{id}, args...)...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func newID() string {
	b := make([]byte, 9)
	_, _ = rand.Read(b)
	return "mcp_" + base64.RawURLEncoding.EncodeToString(b)
}
