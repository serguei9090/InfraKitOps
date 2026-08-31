package orchestrator

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

// ErrNotFound is returned for an unknown runbook / node / run id.
var ErrNotFound = errors.New("not found")

const schema = `
CREATE TABLE IF NOT EXISTS runbook (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL,
  published     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runbook_version (
  runbook_id  TEXT NOT NULL,
  version     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  note        TEXT,
  pinned      INTEGER NOT NULL DEFAULT 0,
  spec_json   TEXT NOT NULL,
  PRIMARY KEY (runbook_id, version)
);
CREATE TABLE IF NOT EXISTS runbook_draft (
  runbook_id  TEXT PRIMARY KEY,
  spec_json   TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS run (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  runbook_id    TEXT NOT NULL,
  runbook_ver   INTEGER NOT NULL,
  status        TEXT NOT NULL,
  dry_run       INTEGER NOT NULL DEFAULT 0,
  triggered_by  TEXT NOT NULL DEFAULT 'local',
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  args_json     TEXT NOT NULL,
  steps_json    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_run_runbook_time ON run(runbook_id, started_at DESC);
CREATE TABLE IF NOT EXISTS ssh_node (
  id          TEXT PRIMARY KEY,
  node_json   TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runbook_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`

// Store is the orchestrator database handle.
type Store struct{ db *sql.DB }

// Open opens (creating if needed) the orchestrator DB and applies the schema.
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

// --- runbooks -------------------------------------------------------------

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(name string) string {
	s := slugRe.ReplaceAllString(strings.ToLower(name), "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "runbook"
	}
	return s
}

// CreateRunbook makes a new runbook seeded with `spec` as a draft (no version
// yet — mirrors the Prompt Library: v1 lands on the first Save).
func (s *Store) CreateRunbook(spec Spec) (*Runbook, error) {
	now := time.Now().UnixMilli()
	rb := &Runbook{ID: newID("rb"), Slug: slugify(spec.Name), CreatedAt: now, UpdatedAt: now, Draft: &spec}
	if _, err := s.db.Exec(`INSERT INTO runbook (id, slug, published, created_at, updated_at) VALUES (?,?,?,?,?)`,
		rb.ID, rb.Slug, 0, now, now); err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(spec)
	if _, err := s.db.Exec(`INSERT INTO runbook_draft (runbook_id, spec_json, updated_at) VALUES (?,?,?)`,
		rb.ID, string(raw), now); err != nil {
		return nil, err
	}
	return rb, nil
}

// GetRunbook loads one runbook with all its versions + draft.
func (s *Store) GetRunbook(id string) (*Runbook, error) {
	rb := &Runbook{ID: id}
	var pub int
	err := s.db.QueryRow(`SELECT slug, published, created_at, updated_at FROM runbook WHERE id = ?`, id).
		Scan(&rb.Slug, &pub, &rb.CreatedAt, &rb.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	rb.Published = pub == 1

	rows, err := s.db.Query(`SELECT version, created_at, note, pinned, spec_json FROM runbook_version WHERE runbook_id = ? ORDER BY version`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var v Version
		var note sql.NullString
		var pinned int
		var specJSON string
		if err := rows.Scan(&v.Version, &v.CreatedAt, &note, &pinned, &specJSON); err != nil {
			return nil, err
		}
		v.Note = note.String
		v.Pinned = pinned == 1
		_ = json.Unmarshal([]byte(specJSON), &v.Spec)
		rb.Versions = append(rb.Versions, v)
	}

	var draftJSON string
	err = s.db.QueryRow(`SELECT spec_json FROM runbook_draft WHERE runbook_id = ?`, id).Scan(&draftJSON)
	if err == nil {
		var d Spec
		if json.Unmarshal([]byte(draftJSON), &d) == nil {
			rb.Draft = &d
		}
	}
	return rb, nil
}

// ListRunbooks returns every runbook (full, with versions) newest-updated first.
func (s *Store) ListRunbooks() ([]*Runbook, error) {
	rows, err := s.db.Query(`SELECT id FROM runbook ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	out := make([]*Runbook, 0, len(ids))
	for _, id := range ids {
		rb, err := s.GetRunbook(id)
		if err != nil {
			return nil, err
		}
		out = append(out, rb)
	}
	return out, nil
}

// SaveDraft upserts the working spec for a runbook.
func (s *Store) SaveDraft(id string, spec Spec) error {
	if _, err := s.GetRunbook(id); err != nil {
		return err
	}
	raw, _ := json.Marshal(spec)
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(`INSERT INTO runbook_draft (runbook_id, spec_json, updated_at) VALUES (?,?,?)
		ON CONFLICT(runbook_id) DO UPDATE SET spec_json = excluded.spec_json, updated_at = excluded.updated_at`,
		id, string(raw), now)
	if err == nil {
		_, _ = s.db.Exec(`UPDATE runbook SET updated_at = ?, slug = ? WHERE id = ?`, now, slugify(spec.Name), id)
	}
	return err
}

// DiscardDraft drops the working spec, reverting to the latest version.
func (s *Store) DiscardDraft(id string) error {
	_, err := s.db.Exec(`DELETE FROM runbook_draft WHERE runbook_id = ?`, id)
	return err
}

// SaveVersion promotes the current draft to a new immutable version.
func (s *Store) SaveVersion(id, note string) (*Runbook, error) {
	rb, err := s.GetRunbook(id)
	if err != nil {
		return nil, err
	}
	if rb.Draft == nil {
		return rb, nil // nothing to save
	}
	n := rb.nextVersion()
	now := time.Now().UnixMilli()
	raw, _ := json.Marshal(*rb.Draft)
	if _, err := s.db.Exec(`INSERT INTO runbook_version (runbook_id, version, created_at, note, pinned, spec_json) VALUES (?,?,?,?,?,?)`,
		id, n, now, nullStr(note), 0, string(raw)); err != nil {
		return nil, err
	}
	_, _ = s.db.Exec(`DELETE FROM runbook_draft WHERE runbook_id = ?`, id)
	_, _ = s.db.Exec(`UPDATE runbook SET updated_at = ? WHERE id = ?`, now, id)
	return s.GetRunbook(id)
}

// RestoreVersion loads a saved version's spec into the draft.
func (s *Store) RestoreVersion(id string, n int) error {
	rb, err := s.GetRunbook(id)
	if err != nil {
		return err
	}
	sp := rb.version(n)
	if sp == nil {
		return ErrNotFound
	}
	return s.SaveDraft(id, *sp)
}

// DeleteVersion removes a saved version (guard: not the latest, not pinned).
func (s *Store) DeleteVersion(id string, n int) error {
	rb, err := s.GetRunbook(id)
	if err != nil {
		return err
	}
	latest := rb.latest()
	if latest != nil && latest.Version == n {
		return errors.New("cannot delete the latest version")
	}
	for _, v := range rb.Versions {
		if v.Version == n && v.Pinned {
			return errors.New("cannot delete a pinned version")
		}
	}
	_, err = s.db.Exec(`DELETE FROM runbook_version WHERE runbook_id = ? AND version = ?`, id, n)
	return err
}

// PinVersion toggles the pinned flag.
func (s *Store) PinVersion(id string, n int, pinned bool) error {
	_, err := s.db.Exec(`UPDATE runbook_version SET pinned = ? WHERE runbook_id = ? AND version = ?`, b2i(pinned), id, n)
	return err
}

// SetPublished flips the published gate.
func (s *Store) SetPublished(id string, published bool) error {
	_, err := s.db.Exec(`UPDATE runbook SET published = ?, updated_at = ? WHERE id = ?`, b2i(published), time.Now().UnixMilli(), id)
	return err
}

// DeleteRunbook removes a runbook and its versions/draft (runs are kept).
func (s *Store) DeleteRunbook(id string) error {
	_, _ = s.db.Exec(`DELETE FROM runbook_version WHERE runbook_id = ?`, id)
	_, _ = s.db.Exec(`DELETE FROM runbook_draft WHERE runbook_id = ?`, id)
	_, err := s.db.Exec(`DELETE FROM runbook WHERE id = ?`, id)
	return err
}

// --- runs ---------------------------------------------------------------

// InsertRun writes the initial (running) row and returns its id.
func (s *Store) InsertRun(r *Run) (int64, error) {
	args, _ := json.Marshal(r.Args)
	steps, _ := json.Marshal(r.Steps)
	res, err := s.db.Exec(`INSERT INTO run (runbook_id, runbook_ver, status, dry_run, triggered_by, started_at, finished_at, args_json, steps_json)
		VALUES (?,?,?,?,?,?,?,?,?)`,
		r.RunbookID, r.RunbookVersion, r.Status, b2i(r.DryRun), nz(r.TriggeredBy, "local"),
		r.StartedAt, nullZero(r.FinishedAt), string(args), string(steps))
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	return id, nil
}

// FinishRun updates status + steps + finished_at.
func (s *Store) FinishRun(id int64, status string, steps []RunStep) error {
	raw, _ := json.Marshal(steps)
	_, err := s.db.Exec(`UPDATE run SET status = ?, finished_at = ?, steps_json = ? WHERE id = ?`,
		status, time.Now().UnixMilli(), string(raw), id)
	return err
}

// ListRuns returns run rows newest first (optionally filtered by runbook).
func (s *Store) ListRuns(runbookID string, limit int) ([]Run, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	q := `SELECT id, runbook_id, runbook_ver, status, dry_run, triggered_by, started_at, finished_at, args_json, steps_json FROM run`
	var args []any
	if runbookID != "" {
		q += ` WHERE runbook_id = ?`
		args = append(args, runbookID)
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
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetRun returns one run by id.
func (s *Store) GetRun(id int64) (*Run, error) {
	row := s.db.QueryRow(`SELECT id, runbook_id, runbook_ver, status, dry_run, triggered_by, started_at, finished_at, args_json, steps_json FROM run WHERE id = ?`, id)
	r, err := scanRun(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanRun(sc scanner) (Run, error) {
	var r Run
	var dry int
	var finished sql.NullInt64
	var argsJSON, stepsJSON string
	if err := sc.Scan(&r.ID, &r.RunbookID, &r.RunbookVersion, &r.Status, &dry, &r.TriggeredBy,
		&r.StartedAt, &finished, &argsJSON, &stepsJSON); err != nil {
		return r, err
	}
	r.DryRun = dry == 1
	if finished.Valid {
		r.FinishedAt = finished.Int64
	}
	_ = json.Unmarshal([]byte(argsJSON), &r.Args)
	_ = json.Unmarshal([]byte(stepsJSON), &r.Steps)
	return r, nil
}

// PruneRuns keeps last maxPer per runbook + newer than retentionDays.
func (s *Store) PruneRuns(runbookID string, retentionDays, maxPer int) {
	if maxPer <= 0 {
		maxPer = 20
	}
	cutoff := int64(0)
	if retentionDays > 0 {
		cutoff = time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour).UnixMilli()
	}
	_, _ = s.db.Exec(`DELETE FROM run WHERE runbook_id = ? AND started_at < ? AND id NOT IN (
		SELECT id FROM run WHERE runbook_id = ? ORDER BY started_at DESC LIMIT ?)`,
		runbookID, cutoff, runbookID, maxPer)
}

// --- ssh nodes --------------------------------------------------------

func (s *Store) ListNodes() ([]SSHNode, error) {
	rows, err := s.db.Query(`SELECT node_json FROM ssh_node ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SSHNode{}
	for rows.Next() {
		var j string
		if err := rows.Scan(&j); err != nil {
			return nil, err
		}
		var n SSHNode
		_ = json.Unmarshal([]byte(j), &n)
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Store) PutNode(n SSHNode) (SSHNode, error) {
	if n.ID == "" {
		n.ID = newID("node")
		n.CreatedAt = time.Now().UnixMilli()
	}
	if n.Port == 0 {
		n.Port = 22
	}
	raw, _ := json.Marshal(n)
	_, err := s.db.Exec(`INSERT INTO ssh_node (id, node_json, created_at) VALUES (?,?,?)
		ON CONFLICT(id) DO UPDATE SET node_json = excluded.node_json`, n.ID, string(raw), n.CreatedAt)
	return n, err
}

func (s *Store) DeleteNode(id string) error {
	_, err := s.db.Exec(`DELETE FROM ssh_node WHERE id = ?`, id)
	return err
}

func (s *Store) GetNode(id string) (*SSHNode, error) {
	var j string
	err := s.db.QueryRow(`SELECT node_json FROM ssh_node WHERE id = ?`, id).Scan(&j)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var n SSHNode
	_ = json.Unmarshal([]byte(j), &n)
	return &n, nil
}

// --- settings --------------------------------------------------------

func (s *Store) GetSettings() map[string]string {
	m := map[string]string{}
	rows, err := s.db.Query(`SELECT key, value FROM runbook_settings`)
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
	_, err := s.db.Exec(`INSERT INTO runbook_settings (key, value) VALUES (?,?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// --- helpers --------------------------------------------------------

func newID(prefix string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(b)
}
func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}
func nullZero(v int64) any {
	if v == 0 {
		return nil
	}
	return v
}
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
func nz(s, def string) string {
	if s == "" {
		return def
	}
	return s
}
