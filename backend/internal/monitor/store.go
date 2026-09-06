package monitor

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

// ErrNotFound is returned when a monitor id doesn't exist for the caller.
var ErrNotFound = errors.New("monitor not found")

const schema = `
CREATE TABLE IF NOT EXISTS monitor (
  id             TEXT PRIMARY KEY,
  owner          TEXT NOT NULL DEFAULT '',
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL,
  target         TEXT NOT NULL,
  interval_sec   INTEGER NOT NULL DEFAULT 60,
  timeout_sec    INTEGER NOT NULL DEFAULT 10,
  fail_threshold INTEGER NOT NULL DEFAULT 3,
  enabled        INTEGER NOT NULL DEFAULT 1,
  config_json    TEXT NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'unknown',
  last_checked_at INTEGER NOT NULL DEFAULT 0,
  last_change_at  INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS monitor_sample (
  monitor_id TEXT NOT NULL,
  t          INTEGER NOT NULL,
  ok         INTEGER NOT NULL,
  value      REAL NOT NULL DEFAULT 0,
  detail     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_monitor_sample ON monitor_sample(monitor_id, t DESC);
`

// Store is the monitor.db handle.
type Store struct{ db *sql.DB }

// Open opens (creating if needed) monitor.db.
func Open(dsn string) (*Store, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply monitor schema: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func newID() string {
	b := make([]byte, 9)
	_, _ = rand.Read(b)
	return "mon_" + base64.RawURLEncoding.EncodeToString(b)
}

func ownerClause(owner string) (string, []any) {
	if owner == "" {
		return "", nil
	}
	return " AND (owner = ? OR owner = '')", []any{owner}
}

// ClaimOrphans assigns unowned monitors to owner (first-admin bootstrap).
func (s *Store) ClaimOrphans(owner string) error {
	if owner == "" {
		return nil
	}
	_, err := s.db.Exec(`UPDATE monitor SET owner = ? WHERE owner = ''`, owner)
	return err
}

// PurgeOwner removes a departed user's monitors + their samples.
func (s *Store) PurgeOwner(owner string) error {
	if owner == "" {
		return nil
	}
	if _, err := s.db.Exec(
		`DELETE FROM monitor_sample WHERE monitor_id IN (SELECT id FROM monitor WHERE owner = ?)`, owner,
	); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM monitor WHERE owner = ?`, owner)
	return err
}

const monCols = `id, owner, name, kind, target, interval_sec, timeout_sec, fail_threshold, enabled, config_json, status, last_checked_at, last_change_at, created_at`

func scanMonitor(sc interface{ Scan(...any) error }) (Monitor, error) {
	var m Monitor
	var cfg string
	var enabled int
	if err := sc.Scan(&m.ID, &m.Owner, &m.Name, &m.Kind, &m.Target, &m.IntervalSec, &m.TimeoutSec,
		&m.FailThreshold, &enabled, &cfg, &m.Status, &m.LastCheckedAt, &m.LastChangeAt, &m.CreatedAt); err != nil {
		return Monitor{}, err
	}
	m.Enabled = enabled != 0
	if cfg != "" {
		_ = json.Unmarshal([]byte(cfg), &m.Config)
	}
	return m, nil
}

// List returns the caller's monitors, newest first.
func (s *Store) List(owner string) ([]Monitor, error) {
	clause, args := ownerClause(owner)
	rows, err := s.db.Query(`SELECT `+monCols+` FROM monitor WHERE 1=1`+clause+` ORDER BY created_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Monitor{}
	for rows.Next() {
		m, err := scanMonitor(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListEnabled returns every enabled monitor across all owners — for boot resume.
func (s *Store) ListEnabled() ([]Monitor, error) {
	rows, err := s.db.Query(`SELECT ` + monCols + ` FROM monitor WHERE enabled = 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Monitor{}
	for rows.Next() {
		m, err := scanMonitor(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Get returns one monitor visible to owner.
func (s *Store) Get(owner, id string) (*Monitor, error) {
	clause, args := ownerClause(owner)
	row := s.db.QueryRow(`SELECT `+monCols+` FROM monitor WHERE id = ?`+clause, append([]any{id}, args...)...)
	m, err := scanMonitor(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// Put inserts or replaces a monitor. A new monitor gets an id + createdAt.
func (s *Store) Put(owner string, m Monitor) (*Monitor, error) {
	m.normalize()
	now := time.Now().UnixMilli()
	if m.ID == "" {
		m.ID = newID()
		m.CreatedAt = now
		m.Owner = owner
		m.Status = StatusUnknown
	} else {
		prev, err := s.Get(owner, m.ID)
		if err != nil {
			return nil, err
		}
		m.Owner = prev.Owner
		m.CreatedAt = prev.CreatedAt
		m.Status = prev.Status
		m.LastCheckedAt = prev.LastCheckedAt
		m.LastChangeAt = prev.LastChangeAt
	}
	cfg, _ := json.Marshal(m.Config)
	if string(cfg) == "null" {
		cfg = []byte("{}")
	}
	enabled := 0
	if m.Enabled {
		enabled = 1
	}
	_, err := s.db.Exec(
		`INSERT INTO monitor (`+monCols+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		 ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, target=excluded.target,
		   interval_sec=excluded.interval_sec, timeout_sec=excluded.timeout_sec,
		   fail_threshold=excluded.fail_threshold, enabled=excluded.enabled, config_json=excluded.config_json`,
		m.ID, m.Owner, m.Name, m.Kind, m.Target, m.IntervalSec, m.TimeoutSec, m.FailThreshold, enabled,
		string(cfg), m.Status, m.LastCheckedAt, m.LastChangeAt, m.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return s.Get(owner, m.ID)
}

// Delete removes a monitor + its samples.
func (s *Store) Delete(owner, id string) error {
	if _, err := s.Get(owner, id); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DELETE FROM monitor_sample WHERE monitor_id = ?`, id); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM monitor WHERE id = ?`, id)
	return err
}

// SetEnabled flips a monitor's enabled flag (pause / resume). When pausing, the
// status is set to "paused"; when resuming, back to "unknown".
func (s *Store) SetEnabled(owner, id string, enabled bool) (*Monitor, error) {
	if _, err := s.Get(owner, id); err != nil {
		return nil, err
	}
	status := StatusPaused
	e := 0
	if enabled {
		status, e = StatusUnknown, 1
	}
	if _, err := s.db.Exec(`UPDATE monitor SET enabled = ?, status = ? WHERE id = ?`, e, status, id); err != nil {
		return nil, err
	}
	return s.Get(owner, id)
}

// recordCheck stores a sample and (when the status changed) the transition. It
// takes the resolved status so the engine's state machine stays in one place.
func (s *Store) recordCheck(id string, smp Sample, newStatus string, changed bool) error {
	if _, err := s.db.Exec(
		`INSERT INTO monitor_sample (monitor_id, t, ok, value, detail) VALUES (?,?,?,?,?)`,
		id, smp.T, boolInt(smp.OK), smp.Value, smp.Detail,
	); err != nil {
		return err
	}
	q := `UPDATE monitor SET status = ?, last_checked_at = ?`
	args := []any{newStatus, smp.T}
	if changed {
		q += `, last_change_at = ?`
		args = append(args, smp.T)
	}
	q += ` WHERE id = ?`
	args = append(args, id)
	_, err := s.db.Exec(q, args...)
	return err
}

// Samples returns a monitor's samples newer than `since` (0 = all), oldest
// first, capped at limit (0 = maxSamplesPerMonitor).
func (s *Store) Samples(owner, id string, since int64, limit int) ([]Sample, error) {
	if _, err := s.Get(owner, id); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > maxSamplesPerMonitor {
		limit = maxSamplesPerMonitor
	}
	rows, err := s.db.Query(
		`SELECT t, ok, value, detail FROM (
		   SELECT t, ok, value, detail FROM monitor_sample WHERE monitor_id = ? AND t > ? ORDER BY t DESC LIMIT ?
		 ) ORDER BY t ASC`, id, since, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Sample{}
	for rows.Next() {
		var smp Sample
		var ok int
		if err := rows.Scan(&smp.T, &ok, &smp.Value, &smp.Detail); err != nil {
			return nil, err
		}
		smp.OK = ok != 0
		out = append(out, smp)
	}
	return out, rows.Err()
}

// prune keeps only the newest maxSamplesPerMonitor rows per monitor.
func (s *Store) prune() error {
	_, err := s.db.Exec(`
		DELETE FROM monitor_sample WHERE rowid IN (
		  SELECT rowid FROM (
		    SELECT rowid, ROW_NUMBER() OVER (PARTITION BY monitor_id ORDER BY t DESC) AS rn
		    FROM monitor_sample
		  ) WHERE rn > ?
		)`, maxSamplesPerMonitor)
	return err
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
