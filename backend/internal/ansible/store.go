package ansible

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

const schema = `
CREATE TABLE IF NOT EXISTS ansible_project (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL DEFAULT '',
  published   INTEGER NOT NULL DEFAULT 0,
  proj_json   TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ansible_run (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner        TEXT NOT NULL DEFAULT '',
  project_id   TEXT NOT NULL,
  playbook     TEXT NOT NULL,
  status       TEXT NOT NULL,
  argv         TEXT NOT NULL,
  events       TEXT NOT NULL DEFAULT '',
  recap        TEXT NOT NULL DEFAULT '',
  triggered_by TEXT NOT NULL DEFAULT 'local',
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER
);
CREATE INDEX IF NOT EXISTS ix_ansible_run_time ON ansible_run(started_at DESC);
CREATE TABLE IF NOT EXISTS ansible_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

// Store is the ansible.db handle.
type Store struct{ db *sql.DB }

// Open opens (creating if needed) ansible.db.
func Open(dsn string) (*Store, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply ansible schema: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func newID(p string) string {
	b := make([]byte, 9)
	_, _ = rand.Read(b)
	return p + "_" + base64.RawURLEncoding.EncodeToString(b)
}

func scopeOwner(owner string) (string, []any) {
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
	for _, t := range []string{"ansible_project", "ansible_run"} {
		if _, err := s.db.Exec(`UPDATE `+t+` SET owner = ? WHERE owner = ''`, owner); err != nil {
			return err
		}
	}
	return nil
}

// --- settings -------------------------------------------------------

func (s *Store) GetSettings() map[string]string {
	m := map[string]string{}
	rows, err := s.db.Query(`SELECT key, value FROM ansible_settings`)
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
	_, err := s.db.Exec(
		`INSERT INTO ansible_settings (key, value) VALUES (?,?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// --- projects ------------------------------------------------------

func (s *Store) ListProjects(viewer string) ([]Project, error) {
	rows, err := s.db.Query(`SELECT proj_json, published, owner FROM ansible_project ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var j, owner string
		var pub int
		if err := rows.Scan(&j, &pub, &owner); err != nil {
			return nil, err
		}
		if viewer != "" && owner != "" && owner != viewer && pub == 0 {
			continue
		}
		var p Project
		if json.Unmarshal([]byte(j), &p) == nil {
			out = append(out, p)
		}
	}
	return out, rows.Err()
}

func (s *Store) GetProject(viewer, id string) (*Project, error) {
	var j, owner string
	var pub int
	err := s.db.QueryRow(`SELECT proj_json, published, owner FROM ansible_project WHERE id = ?`, id).Scan(&j, &pub, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if viewer != "" && owner != "" && owner != viewer && pub == 0 {
		return nil, ErrNotFound
	}
	var p Project
	if err := json.Unmarshal([]byte(j), &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// PutProject inserts or updates. A caller may only overwrite their own row.
func (s *Store) PutProject(owner string, p Project) (Project, error) {
	if p.ID == "" {
		p.ID = newID("aproj")
		p.CreatedAt = time.Now().UnixMilli()
	} else if existing, err := s.GetProject(owner, p.ID); err == nil {
		if p.CreatedAt == 0 {
			p.CreatedAt = existing.CreatedAt
		}
	} else if errors.Is(err, ErrNotFound) {
		return p, ErrNotFound
	}
	if p.Source == "" {
		p.Source = "local"
	}
	j, _ := json.Marshal(p)
	_, err := s.db.Exec(
		`INSERT INTO ansible_project (id, owner, published, proj_json, created_at) VALUES (?,?,?,?,?)
		 ON CONFLICT(id) DO UPDATE SET proj_json = excluded.proj_json, published = excluded.published`,
		p.ID, owner, b2i(p.Published), string(j), p.CreatedAt,
	)
	return p, err
}

func (s *Store) DeleteProject(owner, id string) error {
	w, a := scopeOwner(owner)
	res, err := s.db.Exec(`DELETE FROM ansible_project WHERE id = ?`+w, append([]any{id}, a...)...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// --- runs ---------------------------------------------------------

func (s *Store) InsertRun(r *Run) (int64, error) {
	res, err := s.db.Exec(
		`INSERT INTO ansible_run (owner, project_id, playbook, status, argv, triggered_by, started_at)
		 VALUES (?,?,?,?,?,?,?)`,
		r.Owner, r.ProjectID, r.Playbook, r.Status, r.Argv, nz(r.TriggeredBy, "local"), r.StartedAt,
	)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	return id, nil
}

func (s *Store) FinishRun(id int64, status, events, recap string) error {
	_, err := s.db.Exec(
		`UPDATE ansible_run SET status = ?, events = ?, recap = ?, finished_at = ? WHERE id = ?`,
		status, events, recap, time.Now().UnixMilli(), id,
	)
	return err
}

const runCols = `id, owner, project_id, playbook, status, argv, events, recap, triggered_by, started_at, finished_at`

func scanRun(sc interface{ Scan(...any) error }) (Run, error) {
	var r Run
	var fin sql.NullInt64
	if err := sc.Scan(&r.ID, &r.Owner, &r.ProjectID, &r.Playbook, &r.Status, &r.Argv,
		&r.Events, &r.Recap, &r.TriggeredBy, &r.StartedAt, &fin); err != nil {
		return r, err
	}
	if fin.Valid {
		r.FinishedAt = fin.Int64
	}
	return r, nil
}

// ListRuns — newest first, optionally by project. `full` includes the events blob.
func (s *Store) ListRuns(owner, projectID string, limit int, full bool) ([]Run, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	q := `SELECT ` + runCols + ` FROM ansible_run WHERE 1=1`
	var args []any
	if projectID != "" {
		q += ` AND project_id = ?`
		args = append(args, projectID)
	}
	if w, a := scopeOwner(owner); w != "" {
		q += w
		args = append(args, a...)
	}
	q += ` ORDER BY started_at DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Run{}
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		if !full {
			r.Events = ""
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) GetRun(owner string, id int64) (*Run, error) {
	q := `SELECT ` + runCols + ` FROM ansible_run WHERE id = ?`
	args := []any{id}
	if w, a := scopeOwner(owner); w != "" {
		q += w
		args = append(args, a...)
	}
	r, err := scanRun(s.db.QueryRow(q, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}
