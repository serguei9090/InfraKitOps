package mcp

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"
)

const schema = `
CREATE TABLE IF NOT EXISTS mcp_server (
  id          TEXT PRIMARY KEY,
  cfg_json    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
`

// Store persists the MCP server registry. It shares llm.db — pass the handle
// from llm.Store.DB().
type Store struct{ db *sql.DB }

// NewStore applies the mcp_server schema on the given DB handle.
func NewStore(db *sql.DB) (*Store, error) {
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("apply mcp schema: %w", err)
	}
	return &Store{db: db}, nil
}

// List returns every server, newest first.
func (s *Store) List() ([]ServerConfig, error) {
	rows, err := s.db.Query(`SELECT cfg_json FROM mcp_server ORDER BY created_at DESC`)
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

// Get loads one server.
func (s *Store) Get(id string) (*ServerConfig, error) {
	var j string
	err := s.db.QueryRow(`SELECT cfg_json FROM mcp_server WHERE id = ?`, id).Scan(&j)
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

// Put inserts or updates a server, returning its id (generated on insert).
func (s *Store) Put(c ServerConfig) (string, error) {
	if err := c.Validate(); err != nil {
		return "", err
	}
	if c.ID == "" {
		c.ID = newID()
		c.CreatedAt = time.Now().UnixMilli()
	} else if c.CreatedAt == 0 {
		if existing, err := s.Get(c.ID); err == nil {
			c.CreatedAt = existing.CreatedAt
		} else {
			c.CreatedAt = time.Now().UnixMilli()
		}
	}
	j, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	_, err = s.db.Exec(
		`INSERT INTO mcp_server (id, cfg_json, created_at) VALUES (?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET cfg_json = excluded.cfg_json`,
		c.ID, string(j), c.CreatedAt,
	)
	return c.ID, err
}

// Delete removes a server.
func (s *Store) Delete(id string) error {
	res, err := s.db.Exec(`DELETE FROM mcp_server WHERE id = ?`, id)
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
