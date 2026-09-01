// Package history persists every tool run's result envelope so the UI can
// re-open old runs and diff two runs over time (see NETWORK_MODULE_PLAN.md
// §2.3). Storage is embedded SQLite via the pure-Go modernc driver, so the
// backend stays CGO-free and cross-compiles trivially.
package history

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"github.com/infrakit/backend/internal/envelope"
)

// Store is a handle to the history database.
type Store struct {
	db *sql.DB
}

// RunSummary is the lightweight row shown in the history list.
type RunSummary struct {
	ID          int64          `json:"id"`
	Tool        string         `json:"tool"`
	Target      string         `json:"target"`
	StartedAt   int64          `json:"startedAt"`
	FinishedAt  int64          `json:"finishedAt,omitempty"`
	Status      string         `json:"status"`
	ResultShape string         `json:"resultShape"`
	Summary     map[string]any `json:"summary,omitempty"`
	Pinned      bool           `json:"pinned"`
	Label       string         `json:"label,omitempty"`
}

// Run is a full stored run: the envelope plus its storage metadata.
type Run struct {
	RunSummary
	Params map[string]any `json:"params"`
	Result any            `json:"result"`
}

const schema = `
CREATE TABLE IF NOT EXISTS run (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tool         TEXT    NOT NULL,
  target       TEXT    NOT NULL,
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER,
  status       TEXT    NOT NULL,
  params_json  TEXT    NOT NULL,
  result_shape TEXT    NOT NULL,
  result_json  TEXT    NOT NULL,
  summary_json TEXT,
  pinned       INTEGER NOT NULL DEFAULT 0,
  label        TEXT,
  app_version  TEXT
);
CREATE INDEX IF NOT EXISTS ix_run_tool_target_time ON run(tool, target, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_run_target_time      ON run(target, started_at DESC);
`

// U3 — owner scoping. "" = pre-auth / single-user row.
var migrations = []string{
	`ALTER TABLE run ADD COLUMN owner TEXT NOT NULL DEFAULT ''`,
}

func hscope(owner string) (string, []any) {
	if owner == "" {
		return "", nil
	}
	return " AND (owner = ? OR owner = '')", []any{owner}
}

// ClaimOrphans assigns unowned history rows to owner (first-admin bootstrap).
func (s *Store) ClaimOrphans(owner string) error {
	if owner == "" {
		return nil
	}
	_, err := s.db.Exec(`UPDATE run SET owner = ? WHERE owner = ''`, owner)
	return err
}

// Open opens (creating if needed) the history database at dsn. Use
// "file::memory:?cache=shared" for tests. Applies the schema.
func Open(dsn string) (*Store, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // modernc + a single writer: avoids "database is locked"
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

func (s *Store) Close() error { return s.db.Close() }

// PrunePolicy bounds how much history is kept per (tool, target).
type PrunePolicy struct {
	RetentionDays int
	MaxPerTarget  int
}

// Save stores one run and then prunes its (tool, target) group per policy.
// Returns the new row id.
func (s *Store) Save(owner string, env envelope.Envelope, appVersion string, policy PrunePolicy) (int64, error) {
	if env.Tool == "" || env.Target == "" {
		return 0, errors.New("envelope needs tool and target")
	}
	params, _ := json.Marshal(nonNilMap(env.Params))
	result, err := json.Marshal(env.Result)
	if err != nil {
		return 0, fmt.Errorf("marshal result: %w", err)
	}
	var summary []byte
	if env.Summary != nil {
		summary, _ = json.Marshal(env.Summary)
	}

	res, err := s.db.Exec(
		`INSERT INTO run (tool, target, started_at, finished_at, status, params_json, result_shape, result_json, summary_json, app_version, owner)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		env.Tool, env.Target, env.StartedAt, nullZero(env.FinishedAt), string(env.Status),
		string(params), string(env.ResultShape), string(result), nullBytes(summary), appVersion, owner,
	)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()

	if err := s.pruneGroup(env.Tool, env.Target, policy); err != nil {
		// Pruning is best-effort — a stored run is more important than staying trim.
		return id, nil //nolint:nilerr
	}
	return id, nil
}

// List returns run summaries, newest first. Empty tool/target widen the query.
func (s *Store) List(owner, tool, target string, limit int) ([]RunSummary, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	q := `SELECT id, tool, target, started_at, finished_at, status, result_shape, summary_json, pinned, label FROM run WHERE 1=1`
	args := []any{}
	if tool != "" {
		q += " AND tool = ?"
		args = append(args, tool)
	}
	if target != "" {
		q += " AND target = ?"
		args = append(args, target)
	}
	if w, wa := hscope(owner); w != "" {
		q += w
		args = append(args, wa...)
	}
	q += " ORDER BY started_at DESC LIMIT ?"
	args = append(args, limit)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []RunSummary{}
	for rows.Next() {
		var r RunSummary
		var finished sql.NullInt64
		var summary sql.NullString
		var label sql.NullString
		if err := rows.Scan(&r.ID, &r.Tool, &r.Target, &r.StartedAt, &finished, &r.Status, &r.ResultShape, &summary, &r.Pinned, &label); err != nil {
			return nil, err
		}
		if finished.Valid {
			r.FinishedAt = finished.Int64
		}
		if summary.Valid && summary.String != "" {
			_ = json.Unmarshal([]byte(summary.String), &r.Summary)
		}
		if label.Valid {
			r.Label = label.String
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Get returns one of the caller's runs by id, or (nil, nil) if not found.
func (s *Store) Get(owner string, id int64) (*Run, error) {
	w, wa := hscope(owner)
	row := s.db.QueryRow(
		`SELECT id, tool, target, started_at, finished_at, status, params_json, result_shape, result_json, summary_json, pinned, label FROM run WHERE id = ?`+w,
		append([]any{id}, wa...)...)
	var r Run
	var finished sql.NullInt64
	var params, result string
	var summary, label sql.NullString
	err := row.Scan(&r.ID, &r.Tool, &r.Target, &r.StartedAt, &finished, &r.Status, &params, &r.ResultShape, &result, &summary, &r.Pinned, &label)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if finished.Valid {
		r.FinishedAt = finished.Int64
	}
	_ = json.Unmarshal([]byte(params), &r.Params)
	_ = json.Unmarshal([]byte(result), &r.Result)
	if summary.Valid && summary.String != "" {
		_ = json.Unmarshal([]byte(summary.String), &r.Summary)
	}
	if label.Valid {
		r.Label = label.String
	}
	return &r, nil
}

// SetPinned flags/unflags a run so pruning never removes it.
func (s *Store) SetPinned(owner string, id int64, pinned bool) error {
	w, wa := hscope(owner)
	_, err := s.db.Exec(`UPDATE run SET pinned = ? WHERE id = ?`+w, append([]any{boolInt(pinned), id}, wa...)...)
	return err
}

// SetLabel attaches a user note (also exempts the run from pruning).
func (s *Store) SetLabel(owner string, id int64, label string) error {
	w, wa := hscope(owner)
	_, err := s.db.Exec(`UPDATE run SET label = ? WHERE id = ?`+w, append([]any{nullString(label), id}, wa...)...)
	return err
}

// Delete removes one of the caller's runs.
func (s *Store) Delete(owner string, id int64) error {
	w, wa := hscope(owner)
	_, err := s.db.Exec(`DELETE FROM run WHERE id = ?`+w, append([]any{id}, wa...)...)
	return err
}

// pruneGroup keeps, for one (tool, target): every pinned/labelled run, plus the
// newest MaxPerTarget, plus anything newer than RetentionDays. The broadest set wins.
func (s *Store) pruneGroup(tool, target string, p PrunePolicy) error {
	if p.MaxPerTarget <= 0 && p.RetentionDays <= 0 {
		return nil
	}
	// A run older than cutoff is eligible for pruning (still subject to the
	// keep-newest-N and pinned/labelled protections below). With retention
	// disabled, everything is "older than cutoff".
	cutoff := int64(math.MaxInt64)
	if p.RetentionDays > 0 {
		cutoff = time.Now().Add(-time.Duration(p.RetentionDays) * 24 * time.Hour).UnixMilli()
	}
	keepN := p.MaxPerTarget
	if keepN <= 0 {
		keepN = 1 << 30
	}
	_, err := s.db.Exec(
		`DELETE FROM run
		 WHERE tool = ? AND target = ?
		   AND pinned = 0 AND (label IS NULL OR label = '')
		   AND started_at < ?
		   AND id NOT IN (
		     SELECT id FROM run WHERE tool = ? AND target = ?
		     ORDER BY started_at DESC LIMIT ?
		   )`,
		tool, target, cutoff, tool, target, keepN,
	)
	return err
}

func nonNilMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}
func nullZero(v int64) any {
	if v == 0 {
		return nil
	}
	return v
}
func nullBytes(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return string(b)
}
func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}
func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
