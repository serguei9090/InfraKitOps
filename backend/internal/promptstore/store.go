// Package promptstore persists the Prompt Library server-side for multi-user
// mode (USER_MANAGEMENT_PLAN U4). Each prompt / folder / user-template is a
// JSON blob owned by a user; a prompt may be published to a shared gallery.
// Shares llm.db. Single-user mode never touches this — the client keeps its
// IStoragePort repo.
package promptstore

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/sharedb"
)

const schema = `
CREATE TABLE IF NOT EXISTS prompt (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL DEFAULT '',
  published   INTEGER NOT NULL DEFAULT 0,
  prompt_json TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_folder (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL DEFAULT '',
  folder_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_template (
  id            TEXT PRIMARY KEY,
  owner         TEXT NOT NULL DEFAULT '',
  template_json TEXT NOT NULL
);
`

// Store is the prompt persistence layer over the shared llm.db handle.
type Store struct{ db *sql.DB }

// New applies the schema on the given handle.
func New(db *sql.DB) (*Store, error) {
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("apply prompt schema: %w", err)
	}
	s := &Store{db: db}
	if err := s.ensureShareSchema(); err != nil {
		return nil, fmt.Errorf("apply prompt share schema: %w", err)
	}
	return s, nil
}

func scope(owner string) (string, []any) {
	if owner == "" {
		return "", nil
	}
	return " AND (owner = ? OR owner = '')", []any{owner}
}

// ClaimOrphans assigns unowned rows to owner (first-admin bootstrap).
func (s *Store) ClaimOrphans(owner string) error {
	if owner == "" {
		return nil
	}
	for _, t := range []string{"prompt", "prompt_folder", "prompt_template"} {
		if _, err := s.db.Exec(`UPDATE `+t+` SET owner = ? WHERE owner = ''`, owner); err != nil {
			return err
		}
	}
	return nil
}

// Library returns the caller's folders + prompts (own ∪ orphan ∪ published).
func (s *Store) Library(owner string) (folders []json.RawMessage, prompts []json.RawMessage, err error) {
	fw, fa := scope(owner)
	frows, err := s.db.Query(`SELECT folder_json FROM prompt_folder WHERE 1=1`+fw, fa...)
	if err != nil {
		return nil, nil, err
	}
	defer frows.Close()
	for frows.Next() {
		var j string
		if err := frows.Scan(&j); err != nil {
			return nil, nil, err
		}
		folders = append(folders, json.RawMessage(j))
	}

	pw, pa := scope(owner)
	if owner != "" {
		pw = ` AND (owner = ? OR owner = '' OR published = 1
		         OR id IN (SELECT prompt_id FROM prompt_share WHERE grantee_id = ?))`
		pa = []any{owner, owner}
	}
	prows, err := s.db.Query(`SELECT prompt_json FROM prompt WHERE 1=1`+pw, pa...)
	if err != nil {
		return nil, nil, err
	}
	defer prows.Close()
	for prows.Next() {
		var j string
		if err := prows.Scan(&j); err != nil {
			return nil, nil, err
		}
		prompts = append(prompts, json.RawMessage(j))
	}
	return folders, prompts, nil
}

// promptOwner returns the owner of a prompt row ("" = unowned / missing).
func (s *Store) promptOwner(id string) string {
	var o string
	_ = s.db.QueryRow(`SELECT owner FROM prompt WHERE id = ?`, id).Scan(&o)
	return o
}

// SavePrompt upserts a prompt. `id` is taken from the blob's "id" field. A
// caller may only overwrite their own (or an unowned) row.
func (s *Store) SavePrompt(owner, id string, blob json.RawMessage) error {
	if !s.CanEditPrompt(id, owner) {
		return errForbidden
	}
	_, err := s.db.Exec(
		`INSERT INTO prompt (id, owner, prompt_json, updated_at) VALUES (?,?,?,?)
		 ON CONFLICT(id) DO UPDATE SET prompt_json = excluded.prompt_json, updated_at = excluded.updated_at`,
		id, owner, string(blob), time.Now().UnixMilli(),
	)
	return err
}

func (s *Store) DeletePrompt(owner, id string) error {
	w, a := scope(owner)
	res, err := s.db.Exec(`DELETE FROM prompt WHERE id = ?`+w, append([]any{id}, a...)...)
	if err == nil {
		if n, _ := res.RowsAffected(); n > 0 {
			_ = sharedb.DeleteForThing(s.db, shareTable, shareCol, id)
		}
	}
	return err
}

func (s *Store) SetPublished(owner, id string, published bool) error {
	w, a := scope(owner)
	p := 0
	if published {
		p = 1
	}
	_, err := s.db.Exec(`UPDATE prompt SET published = ? WHERE id = ?`+w, append([]any{p, id}, a...)...)
	return err
}

func (s *Store) SaveFolder(owner, id string, blob json.RawMessage) error {
	_, err := s.db.Exec(
		`INSERT INTO prompt_folder (id, owner, folder_json) VALUES (?,?,?)
		 ON CONFLICT(id) DO UPDATE SET folder_json = excluded.folder_json`,
		id, owner, string(blob),
	)
	return err
}

// DeleteFolder drops the folder and, when orphanDelete, its prompts; otherwise
// the caller has already re-parented them and re-saved.
func (s *Store) DeleteFolder(owner, id string, orphanDelete bool) error {
	w, a := scope(owner)
	if orphanDelete {
		// prompts carry folderId in their blob — the client re-saves the
		// survivors, so here we just drop the folder row.
	}
	_, err := s.db.Exec(`DELETE FROM prompt_folder WHERE id = ?`+w, append([]any{id}, a...)...)
	return err
}

func (s *Store) Templates(owner string) ([]json.RawMessage, error) {
	w, a := scope(owner)
	rows, err := s.db.Query(`SELECT template_json FROM prompt_template WHERE 1=1`+w, a...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []json.RawMessage
	for rows.Next() {
		var j string
		if err := rows.Scan(&j); err != nil {
			return nil, err
		}
		out = append(out, json.RawMessage(j))
	}
	return out, rows.Err()
}

func (s *Store) SaveTemplate(owner, id string, blob json.RawMessage) error {
	_, err := s.db.Exec(
		`INSERT INTO prompt_template (id, owner, template_json) VALUES (?,?,?)
		 ON CONFLICT(id) DO UPDATE SET template_json = excluded.template_json`,
		id, owner, string(blob),
	)
	return err
}

func (s *Store) DeleteTemplate(owner, id string) error {
	w, a := scope(owner)
	_, err := s.db.Exec(`DELETE FROM prompt_template WHERE id = ?`+w, append([]any{id}, a...)...)
	return err
}

var errForbidden = fmt.Errorf("not your prompt")

// ErrForbidden is returned when a caller edits another user's prompt.
func ErrForbidden() error { return errForbidden }

// idOf pulls the "id" field out of a JSON blob.
func idOf(blob json.RawMessage) (string, error) {
	var v struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(blob, &v); err != nil {
		return "", err
	}
	if strings.TrimSpace(v.ID) == "" {
		return "", fmt.Errorf("blob has no id")
	}
	return v.ID, nil
}

// IDOf is exported for handlers.
func IDOf(blob json.RawMessage) (string, error) { return idOf(blob) }
