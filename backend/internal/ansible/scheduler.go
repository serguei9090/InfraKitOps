package ansible

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/infrakit/backend/internal/orchestrator"
)

// Scheduler cron-fires enabled Ansible Schedules (AN4b). Polls the store on a
// fixed tick — schedule edits made through the API are picked up with no
// cross-wiring. Reuses the orchestrator's self-contained cron parser.
type Scheduler struct {
	store    *Store
	engine   *Engine
	interval time.Duration

	mu      sync.Mutex
	running map[string]bool
	cancel  context.CancelFunc
	done    chan struct{}
}

func NewScheduler(store *Store, engine *Engine) *Scheduler {
	return &Scheduler{store: store, engine: engine, interval: 30 * time.Second, running: map[string]bool{}}
}

func (s *Scheduler) Start() {
	if s.store == nil || s.engine == nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	s.done = make(chan struct{})
	go s.loop(ctx)
}

func (s *Scheduler) Stop() {
	if s.cancel == nil {
		return
	}
	s.cancel()
	<-s.done
}

func (s *Scheduler) loop(ctx context.Context) {
	defer close(s.done)
	s.reanchor()
	t := time.NewTicker(s.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			s.tick(ctx, now)
		}
	}
}

// reanchor recomputes NextRunAt for enabled schedules missing one or far in the
// past (covers backend downtime).
func (s *Scheduler) reanchor() {
	list, err := s.store.ListSchedules("")
	if err != nil {
		return
	}
	now := time.Now()
	for _, sc := range list {
		if !sc.Enabled {
			continue
		}
		expr, err := orchestrator.ParseCron(sc.Cron)
		if err != nil {
			continue
		}
		if sc.NextRunAt == 0 || time.UnixMilli(sc.NextRunAt).Before(now.Add(-s.interval)) {
			if n := expr.Next(now); !n.IsZero() {
				sc.NextRunAt = n.UnixMilli()
				_ = s.store.saveScheduleRaw(s.store.scheduleOwner(sc.ID), sc)
			}
		}
	}
}

func (s *Scheduler) tick(ctx context.Context, now time.Time) {
	list, err := s.store.ListSchedules("")
	if err != nil {
		return
	}
	for _, sc := range list {
		if !sc.Enabled || sc.NextRunAt == 0 || now.UnixMilli() < sc.NextRunAt {
			continue
		}
		s.mu.Lock()
		if s.running[sc.ID] {
			s.mu.Unlock()
			continue
		}
		s.running[sc.ID] = true
		s.mu.Unlock()
		go s.fire(ctx, sc)
	}
}

func (s *Scheduler) fire(ctx context.Context, sc Schedule) {
	defer func() {
		s.mu.Lock()
		delete(s.running, sc.ID)
		s.mu.Unlock()
	}()
	owner := s.store.scheduleOwner(sc.ID)

	// Advance NextRunAt first so a slow run can't double-fire.
	if expr, err := orchestrator.ParseCron(sc.Cron); err == nil {
		if n := expr.Next(time.Now()); !n.IsZero() {
			sc.NextRunAt = n.UnixMilli()
		}
	}
	sc.LastRunAt = time.Now().UnixMilli()
	sc.LastError = ""

	job, err := s.store.GetJob(owner, sc.JobID)
	if err != nil {
		sc.LastStatus, sc.LastError = "error", "job not found"
		_ = s.store.saveScheduleRaw(owner, sc)
		return
	}
	_ = s.store.saveScheduleRaw(owner, sc)

	runCtx, cancel := context.WithTimeout(ctx, 6*time.Hour)
	defer cancel()
	mode := RuntimeMode(s.store.GetSettings()["ansibleRuntime"])
	runID := s.engine.Run(runCtx, owner, mode, "schedule", job.Spec(), func(string, any) {})

	if run, gerr := s.store.GetRun(owner, runID); gerr == nil && run != nil {
		sc.LastStatus, sc.LastRunID = run.Status, runID
	} else {
		sc.LastStatus = StatusFailed
	}
	slog.Info("ansible schedule fired", "job", sc.JobID, "schedule", sc.ID, "status", sc.LastStatus)
	_ = s.store.saveScheduleRaw(owner, sc)
}
