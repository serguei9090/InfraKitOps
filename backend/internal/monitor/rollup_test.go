package monitor

import (
	"context"
	"testing"
	"time"
)

// seedSamples bulk-inserts raw samples for a monitor.
func seedSamples(t *testing.T, s *Store, id string, rows []Sample) {
	t.Helper()
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if _, err := tx.Exec(
			`INSERT INTO monitor_sample (monitor_id, t, ok, value, detail) VALUES (?,?,?,?,?)`,
			id, r.T, boolInt(r.OK), r.Value, r.Detail,
		); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestFoldRollsUpAndPrunes(t *testing.T) {
	s := newStore(t)
	m, _ := s.Put("alice", Monitor{Name: "x", Kind: "fake", Target: "x", Enabled: true})
	now := time.Now()

	// 10 samples in one minute, 30h ago (well past the 24h raw cut): 8 ok, 2 fail.
	base := now.Add(-30 * time.Hour).Truncate(time.Minute).UnixMilli()
	var rows []Sample
	for i := 0; i < 10; i++ {
		rows = append(rows, Sample{T: base + int64(i)*1000, OK: i >= 2, Value: float64(10 + i)})
	}
	// plus a fresh sample now (must survive the fold)
	rows = append(rows, Sample{T: now.UnixMilli(), OK: true, Value: 5})
	seedSamples(t, s, m.ID, rows)

	if err := s.fold(now); err != nil {
		t.Fatal(err)
	}

	raw, _ := s.Samples("alice", m.ID, 0, 1000)
	if len(raw) != 1 || raw[0].Value != 5 {
		t.Fatalf("raw after fold = %+v, want just the fresh sample", raw)
	}

	var okc, total int64
	var minMs, avgMs, maxMs float64
	if err := s.db.QueryRow(
		`SELECT ok_count, total, min_ms, avg_ms, max_ms FROM monitor_rollup WHERE monitor_id=? AND period='1m'`, m.ID,
	).Scan(&okc, &total, &minMs, &avgMs, &maxMs); err != nil {
		t.Fatal(err)
	}
	if okc != 8 || total != 10 {
		t.Fatalf("1m bucket okc/total = %d/%d, want 8/10", okc, total)
	}
	// min/avg/max computed over the OK samples only (values 12..19)
	if minMs != 12 || maxMs != 19 {
		t.Fatalf("min/max ms = %v/%v, want 12/19", minMs, maxMs)
	}
}

func TestFold1mInto1h(t *testing.T) {
	s := newStore(t)
	m, _ := s.Put("alice", Monitor{Name: "x", Kind: "fake", Target: "x", Enabled: true})
	now := time.Now()

	// two 1-minute rollup buckets, 8 days old, same hour
	hb := now.Add(-8 * 24 * time.Hour).Truncate(time.Hour).UnixMilli()
	for i, b := range []int64{hb, hb + msMinute} {
		if _, err := s.db.Exec(
			`INSERT INTO monitor_rollup (monitor_id, period, bucket, ok_count, total, min_ms, avg_ms, max_ms)
			 VALUES (?, '1m', ?, ?, ?, ?, ?, ?)`,
			m.ID, b, 5+i, 6+i, 10, 20, 30,
		); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.fold(now); err != nil {
		t.Fatal(err)
	}
	var okc, total int64
	if err := s.db.QueryRow(
		`SELECT ok_count, total FROM monitor_rollup WHERE monitor_id=? AND period='1h'`, m.ID,
	).Scan(&okc, &total); err != nil {
		t.Fatal(err)
	}
	if okc != 11 || total != 13 { // (5+6) ok, (6+7) total
		t.Fatalf("1h bucket = %d/%d, want 11/13", okc, total)
	}
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM monitor_rollup WHERE monitor_id=? AND period='1m'`, m.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("1m buckets left after fold = %d, want 0", n)
	}
}

func TestUptimeMergesRawAndRollup(t *testing.T) {
	s := newStore(t)
	m, _ := s.Put("alice", Monitor{Name: "x", Kind: "fake", Target: "x", Enabled: true})
	now := time.Now()

	// rollup bucket 3 days ago: 90/100 ok
	b := now.Add(-3 * 24 * time.Hour).Truncate(time.Minute).UnixMilli()
	if _, err := s.db.Exec(
		`INSERT INTO monitor_rollup (monitor_id, period, bucket, ok_count, total, min_ms, avg_ms, max_ms)
		 VALUES (?, '1m', ?, 90, 100, 1, 2, 3)`, m.ID, b,
	); err != nil {
		t.Fatal(err)
	}
	// raw last hour: 10/10 ok
	var rows []Sample
	for i := 0; i < 10; i++ {
		rows = append(rows, Sample{T: now.Add(-time.Duration(i) * time.Minute).UnixMilli(), OK: true, Value: 1})
	}
	seedSamples(t, s, m.ID, rows)

	up, err := s.UptimeAt(m.ID, now)
	if err != nil {
		t.Fatal(err)
	}
	// 24h window: only the 10 raw samples → 1.0
	if up.D1 != 1 {
		t.Fatalf("24h uptime = %v, want 1", up.D1)
	}
	// 7d window: 100 ok / 110 total
	if got := up.D7; got < 0.9 || got > 0.91 {
		t.Fatalf("7d uptime = %v, want ~0.909", got)
	}
}

func TestIncidentLifecycle(t *testing.T) {
	f := withFakeProbe(t)
	s := newStore(t)
	e := NewEngine(s)
	m, _ := s.Put("alice", Monitor{Name: "svc", Kind: "fake", Target: "x", Enabled: true, FailThreshold: 1, IntervalSec: 60})

	st := &loopState{}
	e.tick(context.Background(), m.ID, st) // ok → up
	f.ok.Store(false)
	e.tick(context.Background(), m.ID, st) // down → incident opens

	inc, err := s.Incidents("alice", m.ID, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(inc) != 1 || inc[0].EndedAt != 0 {
		t.Fatalf("after down: incidents = %+v", inc)
	}

	f.ok.Store(true)
	e.tick(context.Background(), m.ID, st) // up → incident closes

	inc, _ = s.Incidents("alice", m.ID, 0, 10)
	if len(inc) != 1 || inc[0].EndedAt == 0 {
		t.Fatalf("after recover: incidents = %+v", inc)
	}

	rep, err := s.Report("alice", m.ID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Incidents) != 1 || rep.MTTRMs < 0 {
		t.Fatalf("report = %+v", rep)
	}
}

func TestSeriesAutoResolution(t *testing.T) {
	s := newStore(t)
	m, _ := s.Put("alice", Monitor{Name: "x", Kind: "fake", Target: "x", Enabled: true})
	now := time.Now()
	seedSamples(t, s, m.ID, []Sample{
		{T: now.Add(-2 * time.Minute).UnixMilli(), OK: true, Value: 10},
		{T: now.Add(-1 * time.Minute).UnixMilli(), OK: false, Value: 0},
	})
	period, pts, err := s.Series("alice", m.ID, now.Add(-time.Hour).UnixMilli(), now.UnixMilli(), "auto")
	if err != nil {
		t.Fatal(err)
	}
	if period != "raw" || len(pts) != 2 {
		t.Fatalf("series = %s / %d points", period, len(pts))
	}
	if pts[0].OK != 1 || pts[1].OK != 0 {
		t.Fatalf("raw ok flags = %v/%v", pts[0].OK, pts[1].OK)
	}
}
