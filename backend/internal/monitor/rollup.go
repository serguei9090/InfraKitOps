package monitor

import (
	"database/sql"
	"time"
)

// M5 — sample rollups + incidents + uptime reporting.
//
// Raw samples are kept for 24 h, then folded into 1-minute buckets; 1-minute
// buckets are kept for 7 d, then folded into 1-hour buckets; 1-hour buckets are
// kept for 90 d. Cut-offs are aligned to the target bucket size so every source
// bucket folds exactly once and in full — no additive merge needed.

const rollupSchema = `
CREATE TABLE IF NOT EXISTS monitor_rollup (
  monitor_id TEXT NOT NULL,
  period     TEXT NOT NULL,          -- '1m' | '1h'
  bucket     INTEGER NOT NULL,       -- unix ms, floored to the period
  ok_count   INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  min_ms     REAL NOT NULL DEFAULT 0,
  avg_ms     REAL NOT NULL DEFAULT 0,
  max_ms     REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (monitor_id, period, bucket)
);
CREATE INDEX IF NOT EXISTS ix_monitor_rollup ON monitor_rollup(monitor_id, period, bucket);
CREATE TABLE IF NOT EXISTS monitor_incident (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id TEXT NOT NULL,
  owner      TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL,
  ended_at   INTEGER NOT NULL DEFAULT 0,  -- 0 = ongoing
  detail     TEXT NOT NULL DEFAULT '',
  suppressed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_monitor_incident ON monitor_incident(monitor_id, started_at DESC);
`

const (
	rawRetention     = 24 * time.Hour
	oneMinRetention  = 7 * 24 * time.Hour
	oneHourRetention = 90 * 24 * time.Hour
	msMinute         = int64(60_000)
	msHour           = int64(3_600_000)
)

func (s *Store) txStep(fn func(*sql.Tx) error) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// fold rolls elapsed raw samples into 1-minute buckets and elapsed 1-minute
// buckets into 1-hour buckets, prunes ancient 1-hour buckets, and applies the
// raw hard cap. Runs on the engine's retention ticker.
func (s *Store) fold(now time.Time) error {
	nowMs := now.UnixMilli()
	rawCut := ((nowMs - rawRetention.Milliseconds()) / msMinute) * msMinute
	minCut := ((nowMs - oneMinRetention.Milliseconds()) / msHour) * msHour
	hourCut := nowMs - oneHourRetention.Milliseconds()

	// raw -> 1m
	if err := s.txStep(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`
			INSERT INTO monitor_rollup (monitor_id, period, bucket, ok_count, total, min_ms, avg_ms, max_ms)
			SELECT monitor_id, '1m', (t/60000)*60000,
			       SUM(ok), COUNT(*),
			       COALESCE(MIN(CASE WHEN ok=1 THEN value END),0),
			       COALESCE(AVG(CASE WHEN ok=1 THEN value END),0),
			       COALESCE(MAX(CASE WHEN ok=1 THEN value END),0)
			FROM monitor_sample WHERE t < ?
			GROUP BY monitor_id, (t/60000)*60000
			ON CONFLICT(monitor_id, period, bucket) DO UPDATE SET
			  ok_count=excluded.ok_count, total=excluded.total,
			  min_ms=excluded.min_ms, avg_ms=excluded.avg_ms, max_ms=excluded.max_ms`, rawCut); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM monitor_sample WHERE t < ?`, rawCut)
		return err
	}); err != nil {
		return err
	}

	// 1m -> 1h
	if err := s.txStep(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`
			INSERT INTO monitor_rollup (monitor_id, period, bucket, ok_count, total, min_ms, avg_ms, max_ms)
			SELECT monitor_id, '1h', (bucket/3600000)*3600000,
			       SUM(ok_count), SUM(total),
			       COALESCE(MIN(CASE WHEN ok_count>0 THEN min_ms END),0),
			       CASE WHEN SUM(ok_count)>0 THEN SUM(avg_ms*ok_count)/SUM(ok_count) ELSE 0 END,
			       COALESCE(MAX(CASE WHEN ok_count>0 THEN max_ms END),0)
			FROM monitor_rollup WHERE period='1m' AND bucket < ?
			GROUP BY monitor_id, (bucket/3600000)*3600000
			ON CONFLICT(monitor_id, period, bucket) DO UPDATE SET
			  ok_count=excluded.ok_count, total=excluded.total,
			  min_ms=excluded.min_ms, avg_ms=excluded.avg_ms, max_ms=excluded.max_ms`, minCut); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM monitor_rollup WHERE period='1m' AND bucket < ?`, minCut)
		return err
	}); err != nil {
		return err
	}

	if _, err := s.db.Exec(`DELETE FROM monitor_rollup WHERE period='1h' AND bucket < ?`, hourCut); err != nil {
		return err
	}
	// safety net for very fast intervals inside the 24 h raw window
	return s.prune()
}

// --- incidents -------------------------------------------------------------

// Incident is a maximal down span for a monitor.
type Incident struct {
	ID         int64  `json:"id"`
	MonitorID  string `json:"monitorId"`
	StartedAt  int64  `json:"startedAt"`
	EndedAt    int64  `json:"endedAt"` // 0 = ongoing
	Detail     string `json:"detail,omitempty"`
	Suppressed bool   `json:"suppressed,omitempty"`
}

// Duration returns the incident length in ms (now-relative while ongoing).
func (in Incident) Duration(now int64) int64 {
	end := in.EndedAt
	if end == 0 {
		end = now
	}
	if end < in.StartedAt {
		return 0
	}
	return end - in.StartedAt
}

// OpenIncident starts a down span, unless one is already open for the monitor.
func (s *Store) OpenIncident(id, owner string, at int64, detail string) error {
	var n int
	if err := s.db.QueryRow(
		`SELECT COUNT(*) FROM monitor_incident WHERE monitor_id = ? AND ended_at = 0`, id,
	).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	_, err := s.db.Exec(
		`INSERT INTO monitor_incident (monitor_id, owner, started_at, detail) VALUES (?,?,?,?)`,
		id, owner, at, detail,
	)
	return err
}

// CloseIncident ends the open down span for a monitor (no-op when none open).
func (s *Store) CloseIncident(id string, at int64) error {
	_, err := s.db.Exec(
		`UPDATE monitor_incident SET ended_at = ? WHERE monitor_id = ? AND ended_at = 0`, at, id,
	)
	return err
}

// Incidents returns a monitor's incidents that started at/after `since` (plus
// any still-open one), newest first.
func (s *Store) Incidents(owner, id string, since int64, limit int) ([]Incident, error) {
	if _, err := s.Get(owner, id); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	rows, err := s.db.Query(
		`SELECT id, monitor_id, started_at, ended_at, detail, suppressed
		   FROM monitor_incident
		  WHERE monitor_id = ? AND (started_at >= ? OR ended_at = 0)
		  ORDER BY started_at DESC LIMIT ?`, id, since, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Incident{}
	for rows.Next() {
		var in Incident
		var sup int
		if err := rows.Scan(&in.ID, &in.MonitorID, &in.StartedAt, &in.EndedAt, &in.Detail, &sup); err != nil {
			return nil, err
		}
		in.Suppressed = sup != 0
		out = append(out, in)
	}
	return out, rows.Err()
}

// --- uptime ---------------------------------------------------------------

// UptimeWindows is an ok-ratio (0..1) over trailing windows.
type UptimeWindows struct {
	D1  float64 `json:"24h"`
	D7  float64 `json:"7d"`
	D30 float64 `json:"30d"`
}

type upCounts struct{ ok, total int64 }

// countsSince sums ok / total for a monitor from `since` to now, merging raw
// samples with both rollup periods. Boundary slop is sub-minute.
func (s *Store) countsSince(id string, since int64) (upCounts, error) {
	var c upCounts
	var a, b sql.NullInt64
	if err := s.db.QueryRow(
		`SELECT SUM(ok), COUNT(*) FROM monitor_sample WHERE monitor_id = ? AND t >= ?`, id, since,
	).Scan(&a, &b); err != nil {
		return c, err
	}
	c.ok, c.total = a.Int64, b.Int64
	var g, h sql.NullInt64
	if err := s.db.QueryRow(
		`SELECT SUM(ok_count), SUM(total) FROM monitor_rollup WHERE monitor_id = ? AND bucket >= ?`, id, since,
	).Scan(&g, &h); err != nil {
		return c, err
	}
	c.ok += g.Int64
	c.total += h.Int64
	return c, nil
}

func ratio(c upCounts) float64 {
	if c.total == 0 {
		return 0
	}
	return float64(c.ok) / float64(c.total)
}

// UptimeAt returns the 24h/7d/30d windows for a monitor at time `now`.
func (s *Store) UptimeAt(id string, now time.Time) (UptimeWindows, error) {
	var w UptimeWindows
	for _, spec := range []struct {
		p *float64
		d time.Duration
	}{
		{&w.D1, 24 * time.Hour},
		{&w.D7, 7 * 24 * time.Hour},
		{&w.D30, 30 * 24 * time.Hour},
	} {
		c, err := s.countsSince(id, now.Add(-spec.d).UnixMilli())
		if err != nil {
			return w, err
		}
		*spec.p = ratio(c)
	}
	return w, nil
}

// Summary returns per-monitor and per-tag uptime windows for the caller.
func (s *Store) Summary(owner string, now time.Time) (perMonitor, perTag map[string]UptimeWindows, err error) {
	list, err := s.List(owner, "")
	if err != nil {
		return nil, nil, err
	}
	perMonitor = map[string]UptimeWindows{}
	type agg struct{ d1, d7, d30 upCounts }
	tags := map[string]*agg{}
	windows := []time.Duration{24 * time.Hour, 7 * 24 * time.Hour, 30 * 24 * time.Hour}
	for _, m := range list {
		var cs [3]upCounts
		for i, d := range windows {
			cs[i], err = s.countsSince(m.ID, now.Add(-d).UnixMilli())
			if err != nil {
				return nil, nil, err
			}
		}
		perMonitor[m.ID] = UptimeWindows{ratio(cs[0]), ratio(cs[1]), ratio(cs[2])}
		for _, t := range m.TagList() {
			a := tags[t]
			if a == nil {
				a = &agg{}
				tags[t] = a
			}
			a.d1.ok += cs[0].ok
			a.d1.total += cs[0].total
			a.d7.ok += cs[1].ok
			a.d7.total += cs[1].total
			a.d30.ok += cs[2].ok
			a.d30.total += cs[2].total
		}
	}
	perTag = map[string]UptimeWindows{}
	for t, a := range tags {
		perTag[t] = UptimeWindows{ratio(a.d1), ratio(a.d7), ratio(a.d30)}
	}
	return perMonitor, perTag, nil
}

// --- report -------------------------------------------------------------

// Report is a monitor's 30-day reliability summary.
type Report struct {
	Monitor     Monitor       `json:"monitor"`
	Uptime      UptimeWindows `json:"uptime"`
	MTTRMs      int64         `json:"mttrMs"`      // mean time to recovery, closed incidents / 30d
	MTBFMs      int64         `json:"mtbfMs"`      // mean time between incidents / 30d
	Incidents   []Incident    `json:"incidents"`   // last 30 d
	GeneratedAt int64         `json:"generatedAt"`
}

// Report builds a 30-day report for one monitor.
func (s *Store) Report(owner, id string, now time.Time) (*Report, error) {
	m, err := s.Get(owner, id)
	if err != nil {
		return nil, err
	}
	up, err := s.UptimeAt(id, now)
	if err != nil {
		return nil, err
	}
	since := now.Add(-30 * 24 * time.Hour).UnixMilli()
	inc, err := s.Incidents(owner, id, since, 1000)
	if err != nil {
		return nil, err
	}
	var closed, sumRecovery int64
	for _, in := range inc {
		if in.EndedAt > 0 {
			closed++
			sumRecovery += in.EndedAt - in.StartedAt
		}
	}
	rep := &Report{Monitor: *m, Uptime: up, Incidents: inc, GeneratedAt: now.UnixMilli()}
	if closed > 0 {
		rep.MTTRMs = sumRecovery / closed
	}
	if n := int64(len(inc)); n > 0 {
		rep.MTBFMs = (30 * 24 * time.Hour).Milliseconds() / n
	}
	return rep, nil
}

// --- series (chart resolution) -----------------------------------------

// SeriesPoint is one downsampled point. For raw resolution OK is 0/1 and Total
// is 1; for a rollup, OK is the ok-ratio over the bucket.
type SeriesPoint struct {
	T     int64   `json:"t"`
	OK    float64 `json:"ok"`
	Value float64 `json:"value"` // avg ms of the ok samples
	Min   float64 `json:"min"`
	Max   float64 `json:"max"`
	Total int64   `json:"total"`
}

// Series returns points for [from,to]. period: "raw" | "1m" | "1h" | "" (auto).
func (s *Store) Series(owner, id string, from, to int64, period string) (string, []SeriesPoint, error) {
	if _, err := s.Get(owner, id); err != nil {
		return "", nil, err
	}
	if to <= 0 {
		to = time.Now().UnixMilli()
	}
	if from <= 0 || from >= to {
		from = to - rawRetention.Milliseconds()
	}
	if period == "" || period == "auto" {
		switch span := to - from; {
		case span <= 25*time.Hour.Milliseconds():
			period = "raw"
		case span <= 8*24*time.Hour.Milliseconds():
			period = "1m"
		default:
			period = "1h"
		}
	}

	var rows *sql.Rows
	var err error
	switch period {
	case "raw":
		rows, err = s.db.Query(
			`SELECT t, ok, value, value, value, 1 FROM monitor_sample
			  WHERE monitor_id = ? AND t BETWEEN ? AND ? ORDER BY t ASC`, id, from, to)
	case "1m":
		rows, err = s.db.Query(`
			SELECT bucket, ok_count, avg_ms, min_ms, max_ms, total FROM monitor_rollup
			 WHERE monitor_id = ? AND period = '1m' AND bucket BETWEEN ? AND ?
			UNION ALL
			SELECT (t/60000)*60000, SUM(ok),
			       COALESCE(AVG(CASE WHEN ok=1 THEN value END),0),
			       COALESCE(MIN(CASE WHEN ok=1 THEN value END),0),
			       COALESCE(MAX(CASE WHEN ok=1 THEN value END),0), COUNT(*)
			  FROM monitor_sample WHERE monitor_id = ? AND t BETWEEN ? AND ?
			  GROUP BY (t/60000)*60000
			ORDER BY 1 ASC`, id, from, to, id, from, to)
	default: // 1h
		period = "1h"
		rows, err = s.db.Query(`
			SELECT (bkt/3600000)*3600000 AS hb, SUM(okc),
			       CASE WHEN SUM(okc)>0 THEN SUM(av*okc)/SUM(okc) ELSE 0 END,
			       COALESCE(MIN(CASE WHEN okc>0 THEN mn END),0),
			       COALESCE(MAX(CASE WHEN okc>0 THEN mx END),0), SUM(tot)
			  FROM (
			    SELECT bucket bkt, ok_count okc, total tot, min_ms mn, avg_ms av, max_ms mx
			      FROM monitor_rollup
			     WHERE monitor_id = ? AND period IN ('1m','1h') AND bucket BETWEEN ? AND ?
			    UNION ALL
			    SELECT (t/60000)*60000, SUM(ok), COUNT(*),
			           COALESCE(MIN(CASE WHEN ok=1 THEN value END),0),
			           COALESCE(AVG(CASE WHEN ok=1 THEN value END),0),
			           COALESCE(MAX(CASE WHEN ok=1 THEN value END),0)
			      FROM monitor_sample WHERE monitor_id = ? AND t BETWEEN ? AND ?
			      GROUP BY (t/60000)*60000
			  )
			  GROUP BY (bkt/3600000)*3600000 ORDER BY hb ASC`, id, from, to, id, from, to)
	}
	if err != nil {
		return "", nil, err
	}
	defer rows.Close()

	out := []SeriesPoint{}
	for rows.Next() {
		var p SeriesPoint
		var okRaw float64
		if err := rows.Scan(&p.T, &okRaw, &p.Value, &p.Min, &p.Max, &p.Total); err != nil {
			return "", nil, err
		}
		if period == "raw" {
			p.OK = okRaw // 0 or 1
		} else if p.Total > 0 {
			p.OK = okRaw / float64(p.Total) // ok_count / total
		}
		out = append(out, p)
	}
	return period, out, rows.Err()
}
