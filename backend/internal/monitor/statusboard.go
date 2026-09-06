package monitor

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"
)

// M5 — public status pages. A board is an owner-scoped, token-addressed
// read-only view of a subset of that owner's monitors (by tag). The token is
// the only credential: GET /status/{token} needs no auth and returns nothing
// beyond name / status / uptime (+ optional open-incident timestamps).

const statusBoardSchema = `
CREATE TABLE IF NOT EXISTS monitor_status_board (
  id             TEXT PRIMARY KEY,
  owner          TEXT NOT NULL DEFAULT '',
  token          TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL DEFAULT '',
  tags           TEXT NOT NULL DEFAULT '',   -- comma list; empty = every monitor
  show_incidents INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL
);
`

// StatusBoard is a configured public page.
type StatusBoard struct {
	ID            string `json:"id"`
	Owner         string `json:"owner,omitempty"`
	Token         string `json:"token"`
	Title         string `json:"title"`
	Tags          string `json:"tags"`
	ShowIncidents bool   `json:"showIncidents"`
	CreatedAt     int64  `json:"createdAt"`
}

func boardToken() string {
	b := make([]byte, 18)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func scanBoard(sc interface{ Scan(...any) error }) (StatusBoard, error) {
	var b StatusBoard
	var show int
	if err := sc.Scan(&b.ID, &b.Owner, &b.Token, &b.Title, &b.Tags, &show, &b.CreatedAt); err != nil {
		return StatusBoard{}, err
	}
	b.ShowIncidents = show != 0
	return b, nil
}

const boardCols = `id, owner, token, title, tags, show_incidents, created_at`

// ListBoards returns the caller's status boards, newest first.
func (s *Store) ListBoards(owner string) ([]StatusBoard, error) {
	clause, args := ownerClause(owner)
	rows, err := s.db.Query(`SELECT `+boardCols+` FROM monitor_status_board WHERE 1=1`+clause+` ORDER BY created_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StatusBoard{}
	for rows.Next() {
		b, err := scanBoard(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// PutBoard creates (blank id) or updates a board. The token is set on create
// and only changes via RotateBoardToken.
func (s *Store) PutBoard(owner string, b StatusBoard) (*StatusBoard, error) {
	b.Title = strings.TrimSpace(b.Title)
	b.Tags = strings.TrimSpace(b.Tags)
	if b.ID == "" {
		b.ID = "sb_" + boardToken()[:12]
		b.Token = boardToken()
		b.Owner = owner
		b.CreatedAt = time.Now().UnixMilli()
	} else {
		prev, err := s.getBoard(owner, b.ID)
		if err != nil {
			return nil, err
		}
		b.Owner, b.Token, b.CreatedAt = prev.Owner, prev.Token, prev.CreatedAt
	}
	show := 0
	if b.ShowIncidents {
		show = 1
	}
	if _, err := s.db.Exec(
		`INSERT INTO monitor_status_board (`+boardCols+`) VALUES (?,?,?,?,?,?,?)
		 ON CONFLICT(id) DO UPDATE SET title=excluded.title, tags=excluded.tags, show_incidents=excluded.show_incidents`,
		b.ID, b.Owner, b.Token, b.Title, b.Tags, show, b.CreatedAt,
	); err != nil {
		return nil, err
	}
	return s.getBoard(owner, b.ID)
}

func (s *Store) getBoard(owner, id string) (*StatusBoard, error) {
	clause, args := ownerClause(owner)
	row := s.db.QueryRow(`SELECT `+boardCols+` FROM monitor_status_board WHERE id = ?`+clause, append([]any{id}, args...)...)
	b, err := scanBoard(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// RotateBoardToken issues a fresh token, invalidating the old public URL.
func (s *Store) RotateBoardToken(owner, id string) (*StatusBoard, error) {
	if _, err := s.getBoard(owner, id); err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(`UPDATE monitor_status_board SET token = ? WHERE id = ?`, boardToken(), id); err != nil {
		return nil, err
	}
	return s.getBoard(owner, id)
}

// DeleteBoard removes a board.
func (s *Store) DeleteBoard(owner, id string) error {
	if _, err := s.getBoard(owner, id); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM monitor_status_board WHERE id = ?`, id)
	return err
}

// --- the public payload ------------------------------------------------

// PublicComponent is one monitor as seen on a status page — no target, no
// config, no probe detail.
type PublicComponent struct {
	Name   string        `json:"name"`
	Status string        `json:"status"` // "up" | "down" | "unknown" | "paused"
	Uptime UptimeWindows `json:"uptime"`
}

// PublicIncident is an open outage — name + when, nothing else.
type PublicIncident struct {
	Name      string `json:"name"`
	StartedAt int64  `json:"startedAt"`
	EndedAt   int64  `json:"endedAt"` // 0 = ongoing
}

// PublicStatus is the whole response of GET /status/{token}.
type PublicStatus struct {
	Title       string            `json:"title"`
	GeneratedAt int64             `json:"generatedAt"`
	OK          bool              `json:"ok"` // every component up
	Components  []PublicComponent `json:"components"`
	Incidents   []PublicIncident  `json:"incidents"`
}

// PublicStatus builds the read-only page for a board token, or ErrNotFound.
func (s *Store) PublicStatus(token string, now time.Time) (*PublicStatus, error) {
	row := s.db.QueryRow(`SELECT `+boardCols+` FROM monitor_status_board WHERE token = ?`, token)
	b, err := scanBoard(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	mons, err := s.List(b.Owner, "")
	if err != nil {
		return nil, err
	}
	want := map[string]bool{}
	for _, t := range strings.Split(b.Tags, ",") {
		if t = strings.TrimSpace(t); t != "" {
			want[strings.ToLower(t)] = true
		}
	}

	out := &PublicStatus{Title: b.Title, GeneratedAt: now.UnixMilli(), OK: true}
	for _, m := range mons {
		if len(want) > 0 {
			hit := false
			for _, t := range m.TagList() {
				if want[strings.ToLower(t)] {
					hit = true
					break
				}
			}
			if !hit {
				continue
			}
		}
		up, err := s.UptimeAt(m.ID, now)
		if err != nil {
			return nil, err
		}
		out.Components = append(out.Components, PublicComponent{Name: m.Name, Status: m.Status, Uptime: up})
		if m.Status == StatusDown {
			out.OK = false
			if b.ShowIncidents {
				if in := s.openIncident(m.ID); in != nil {
					out.Incidents = append(out.Incidents, PublicIncident{Name: m.Name, StartedAt: in.StartedAt, EndedAt: in.EndedAt})
				}
			}
		}
	}
	if out.Components == nil {
		out.Components = []PublicComponent{}
	}
	if out.Incidents == nil {
		out.Incidents = []PublicIncident{}
	}
	return out, nil
}

// openIncident returns a monitor's currently-open incident, or nil.
func (s *Store) openIncident(id string) *Incident {
	row := s.db.QueryRow(
		`SELECT id, monitor_id, started_at, ended_at, detail, suppressed
		   FROM monitor_incident WHERE monitor_id = ? AND ended_at = 0
		  ORDER BY started_at DESC LIMIT 1`, id,
	)
	var in Incident
	var sup int
	if err := row.Scan(&in.ID, &in.MonitorID, &in.StartedAt, &in.EndedAt, &in.Detail, &sup); err != nil {
		return nil
	}
	in.Suppressed = sup != 0
	return &in
}
