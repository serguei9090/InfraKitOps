package backup

import (
	"context"
	"log/slog"
	"time"
)

// Scheduler runs Snapshot on an interval and prunes old archives.
type Scheduler struct {
	DataDir  string
	OutDir   string
	Version  string
	Interval time.Duration
	Keep     int
}

// Run blocks until ctx is cancelled, snapshotting every Interval (first after
// one Interval, not immediately).
func (s *Scheduler) Run(ctx context.Context) {
	if s.Interval <= 0 {
		return
	}
	t := time.NewTicker(s.Interval)
	defer t.Stop()
	slog.Info("backup scheduler started", "dir", s.OutDir, "interval", s.Interval.String(), "keep", s.Keep)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.once()
		}
	}
}

// Once takes a snapshot now (used by the admin endpoint + shutdown hook).
func (s *Scheduler) Once() (string, error) {
	return Snapshot(s.DataDir, s.OutDir, s.Version)
}

func (s *Scheduler) once() {
	path, err := s.Once()
	if err != nil {
		slog.Error("backup failed", "err", err)
		return
	}
	if err := Prune(s.OutDir, s.Keep); err != nil {
		slog.Warn("backup prune failed", "err", err)
	}
	slog.Info("backup written", "archive", path)
}
