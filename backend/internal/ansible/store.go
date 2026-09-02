package ansible

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
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
  job_id       TEXT NOT NULL DEFAULT '',
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
CREATE TABLE IF NOT EXISTS ansible_job (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL DEFAULT '',
  project_id  TEXT NOT NULL,
  published   INTEGER NOT NULL DEFAULT 0,
  job_json    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ansible_schedule (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL DEFAULT '',
  sched_json  TEXT NOT NULL,
  next_run_at INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
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
	// AN1: add ansible_run.job_id to a DB created by AN0. Ignore "duplicate
	// column" on an already-migrated DB.
	if _, err := db.Exec(`ALTER TABLE ansible_run ADD COLUMN job_id TEXT NOT NULL DEFAULT ''`); err != nil &&
		!strings.Contains(err.Error(), "duplicate column") {
		_ = db.Close()
		return nil, fmt.Errorf("migrate ansible_run: %w", err)
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
	for _, t := range []string{"ansible_project", "ansible_run", "ansible_job", "ansible_schedule"} {
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

// --- jobs ---------------------------------------------------------

func (s *Store) ListJobs(viewer, projectID string) ([]Job, error) {
	q := `SELECT job_json, published, owner FROM ansible_job`
	var args []any
	if projectID != "" {
		q += ` WHERE project_id = ?`
		args = append(args, projectID)
	}
	q += ` ORDER BY created_at DESC`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Job{}
	for rows.Next() {
		var j, owner string
		var pub int
		if err := rows.Scan(&j, &pub, &owner); err != nil {
			return nil, err
		}
		if viewer != "" && owner != "" && owner != viewer && pub == 0 {
			continue
		}
		var job Job
		if json.Unmarshal([]byte(j), &job) == nil {
			out = append(out, job)
		}
	}
	return out, rows.Err()
}

func (s *Store) GetJob(viewer, id string) (*Job, error) {
	var j, owner string
	var pub int
	err := s.db.QueryRow(`SELECT job_json, published, owner FROM ansible_job WHERE id = ?`, id).Scan(&j, &pub, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if viewer != "" && owner != "" && owner != viewer && pub == 0 {
		return nil, ErrNotFound
	}
	var job Job
	if err := json.Unmarshal([]byte(j), &job); err != nil {
		return nil, err
	}
	return &job, nil
}

// PutJob inserts or updates. A caller may only overwrite their own row.
func (s *Store) PutJob(owner string, j Job) (Job, error) {
	if j.ID == "" {
		j.ID = newID("ajob")
		j.CreatedAt = time.Now().UnixMilli()
	} else if existing, err := s.GetJob(owner, j.ID); err == nil {
		if j.CreatedAt == 0 {
			j.CreatedAt = existing.CreatedAt
		}
	} else if errors.Is(err, ErrNotFound) {
		return j, ErrNotFound
	}
	blob, _ := json.Marshal(j)
	_, err := s.db.Exec(
		`INSERT INTO ansible_job (id, owner, project_id, published, job_json, created_at) VALUES (?,?,?,?,?,?)
		 ON CONFLICT(id) DO UPDATE SET job_json = excluded.job_json, published = excluded.published, project_id = excluded.project_id`,
		j.ID, owner, j.ProjectID, b2i(j.Published), string(blob), j.CreatedAt,
	)
	return j, err
}

func (s *Store) DeleteJob(owner, id string) error {
	w, a := scopeOwner(owner)
	res, err := s.db.Exec(`DELETE FROM ansible_job WHERE id = ?`+w, append([]any{id}, a...)...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// --- schedules ---------------------------------------------------

func (s *Store) ListSchedules(viewer string) ([]Schedule, error) {
	rows, err := s.db.Query(`SELECT sched_json, owner FROM ansible_schedule ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Schedule{}
	for rows.Next() {
		var j, owner string
		if err := rows.Scan(&j, &owner); err != nil {
			return nil, err
		}
		if viewer != "" && owner != "" && owner != viewer {
			continue
		}
		var sc Schedule
		if json.Unmarshal([]byte(j), &sc) == nil {
			out = append(out, sc)
		}
	}
	return out, rows.Err()
}

func (s *Store) GetSchedule(viewer, id string) (*Schedule, error) {
	var j, owner string
	err := s.db.QueryRow(`SELECT sched_json, owner FROM ansible_schedule WHERE id = ?`, id).Scan(&j, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if viewer != "" && owner != "" && owner != viewer {
		return nil, ErrNotFound
	}
	var sc Schedule
	if err := json.Unmarshal([]byte(j), &sc); err != nil {
		return nil, err
	}
	return &sc, nil
}

// PutSchedule inserts or updates (owner-checked on update).
func (s *Store) PutSchedule(owner string, sc Schedule) (Schedule, error) {
	if sc.ID == "" {
		sc.ID = newID("asch")
		sc.CreatedAt = time.Now().UnixMilli()
	} else if _, err := s.GetSchedule(owner, sc.ID); errors.Is(err, ErrNotFound) {
		return sc, ErrNotFound
	}
	return sc, s.saveScheduleRaw(owner, sc)
}

// saveScheduleRaw persists without an ownership check — for the scheduler's own
// bookkeeping writes.
func (s *Store) saveScheduleRaw(owner string, sc Schedule) error {
	blob, _ := json.Marshal(sc)
	_, err := s.db.Exec(
		`INSERT INTO ansible_schedule (id, owner, sched_json, next_run_at, created_at) VALUES (?,?,?,?,?)
		 ON CONFLICT(id) DO UPDATE SET sched_json = excluded.sched_json, next_run_at = excluded.next_run_at`,
		sc.ID, owner, string(blob), sc.NextRunAt, sc.CreatedAt,
	)
	return err
}

func (s *Store) DeleteSchedule(owner, id string) error {
	w, a := scopeOwner(owner)
	// scopeOwner allows owner='' rows too; a schedule always has an owner in
	// multi-user, and '' in single-user — both fine here.
	res, err := s.db.Exec(`DELETE FROM ansible_schedule WHERE id = ?`+w, append([]any{id}, a...)...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// scheduleOwner returns the stored owner for a schedule id ("" if none / not
// found) — the scheduler needs it to run the job as the right user.
func (s *Store) scheduleOwner(id string) string {
	var owner string
	_ = s.db.QueryRow(`SELECT owner FROM ansible_schedule WHERE id = ?`, id).Scan(&owner)
	return owner
}

// --- runs ---------------------------------------------------------

func (s *Store) InsertRun(r *Run) (int64, error) {
	res, err := s.db.Exec(
		`INSERT INTO ansible_run (owner, project_id, job_id, playbook, status, argv, triggered_by, started_at)
		 VALUES (?,?,?,?,?,?,?,?)`,
		r.Owner, r.ProjectID, r.JobID, r.Playbook, r.Status, r.Argv, nz(r.TriggeredBy, "local"), r.StartedAt,
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

const runCols = `id, owner, project_id, job_id, playbook, status, argv, events, recap, triggered_by, started_at, finished_at`

func scanRun(sc interface{ Scan(...any) error }) (Run, error) {
	var r Run
	var fin sql.NullInt64
	if err := sc.Scan(&r.ID, &r.Owner, &r.ProjectID, &r.JobID, &r.Playbook, &r.Status, &r.Argv,
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
