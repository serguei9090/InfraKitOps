// Package formstore persists FormFlow forms server-side for multi-user mode
// (SHARING_PLAN.md SH3). Mirrors promptstore: each form is a JSON blob owned
// by a user, optionally published, optionally shared. Shares llm.db.
// Single-user mode never touches this — the client keeps its IStoragePort
// (name-keyed) repo.
package formstore

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

const schema = `
CREATE TABLE IF NOT EXISTS form (
  id         TEXT PRIMARY KEY,
  owner      TEXT NOT NULL DEFAULT '',
  published  INTEGER NOT NULL DEFAULT 0,
  name       TEXT NOT NULL,
  form_json  TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS form_owner ON form(owner);`

// ErrForbidden is returned when a caller may not touch a form.
var ErrForbidden = errors.New("not your form")

// ErrNotFound is returned for an unknown id.
var ErrNotFound = errors.New("form not found")

// Store is the form persistence layer over the shared llm.db handle.
type Store struct{ db *sql.DB }

// New applies the schema (form + form_share).
func New(db *sql.DB) (*Store, error) {
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("apply form schema: %w", err)
	}
	s := &Store{db: db}
	if err := s.ensureShareSchema(); err != nil {
		return nil, fmt.Errorf("apply form share schema: %w", err)
	}
	return s, nil
}

// ClaimOrphans assigns unowned rows to owner (first-admin bootstrap).
func (s *Store) ClaimOrphans(owner string) error {
	if owner == "" {
		return nil
	}
	_, err := s.db.Exec(`UPDATE form SET owner = ? WHERE owner = ''`, owner)
	return err
}

func (s *Store) owner(id string) string {
	var o string
	_ = s.db.QueryRow(`SELECT owner FROM form WHERE id = ?`, id).Scan(&o)
	return o
}

// Entry is one row in a viewer's form list.
type Entry struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Published bool   `json:"published"`
	Owner     string `json:"owner"`
	CanEdit   bool   `json:"canEdit"`
	Shared    bool   `json:"shared"` // reached via a share grant (not owned)
}

// List returns the forms `viewer` may see: own ∪ orphan ∪ published ∪ shared.
func (s *Store) List(viewer string) ([]Entry, error) {
	where := ``
	var args []any
	if viewer != "" {
		where = ` WHERE owner = ? OR owner = '' OR published = 1
		          OR id IN (SELECT form_id FROM form_share WHERE grantee_id = ?)`
		args = []any{viewer, viewer}
	}
	rows, err := s.db.Query(`SELECT id, name, published, owner FROM form`+where+` ORDER BY name`, args...)
	if err != nil {
		return nil, err
	}
	out := []Entry{}
	for rows.Next() {
		var e Entry
		var pub int
		if err := rows.Scan(&e.ID, &e.Name, &pub, &e.Owner); err != nil {
			rows.Close()
			return nil, err
		}
		e.Published = pub == 1
		out = append(out, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Second pass — SharedAccess opens its own query, so the SELECT above
	// must be fully drained first (SetMaxOpenConns(1)).
	for i := range out {
		e := &out[i]
		if viewer == "" || e.Owner == "" || e.Owner == viewer {
			e.CanEdit = true
			continue
		}
		_, e.CanEdit = s.SharedAccess(e.ID, viewer)
		e.Shared = true
	}
	return out, nil
}

// Get returns a form blob if `viewer` may see it.
func (s *Store) Get(viewer, id string) (json.RawMessage, error) {
	var blob, owner string
	var pub int
	err := s.db.QueryRow(`SELECT form_json, owner, published FROM form WHERE id = ?`, id).Scan(&blob, &owner, &pub)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if viewer != "" && owner != "" && owner != viewer && pub == 0 {
		if v, _ := s.SharedAccess(id, viewer); !v {
			return nil, ErrNotFound
		}
	}
	return json.RawMessage(blob), nil
}

// Save upserts a form. The caller may only overwrite their own row or one
// shared to them with edit rights.
func (s *Store) Save(owner, id, name string, blob json.RawMessage) error {
	if !s.CanEdit(id, owner) {
		return ErrForbidden
	}
	_, err := s.db.Exec(
		`INSERT INTO form (id, owner, name, form_json, updated_at) VALUES (?,?,?,?,?)
		 ON CONFLICT(id) DO UPDATE SET name = excluded.name, form_json = excluded.form_json, updated_at = excluded.updated_at`,
		id, owner, name, string(blob), time.Now().UnixMilli(),
	)
	return err
}

// Delete removes a form (owner only).
func (s *Store) Delete(owner, id string) error {
	if o := s.owner(id); o != "" && owner != "" && o != owner {
		return ErrForbidden
	}
	res, err := s.db.Exec(`DELETE FROM form WHERE id = ?`, id)
	if err == nil {
		if n, _ := res.RowsAffected(); n > 0 {
			_ = deleteForThing(s.db, id)
		}
	}
	return err
}

// SetPublished toggles the public flag (owner only).
func (s *Store) SetPublished(owner, id string, published bool) error {
	if o := s.owner(id); o != "" && owner != "" && o != owner {
		return ErrForbidden
	}
	p := 0
	if published {
		p = 1
	}
	_, err := s.db.Exec(`UPDATE form SET published = ? WHERE id = ?`, p, id)
	return err
}
