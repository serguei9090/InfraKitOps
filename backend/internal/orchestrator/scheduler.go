package orchestrator

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/infrakit/backend/internal/sse"
)

// Scheduler fires enabled RunSchedules when their cron time comes due (R4b).
// It polls the store on a fixed tick so schedule edits made through the API are
// picked up without any cross-wiring. Only published runbooks are run.
type Scheduler struct {
	store    *Store
	engine   *Engine
	interval time.Duration

	mu      sync.Mutex
	running map[string]bool // schedule ids with an in-flight fire
	cancel  context.CancelFunc
	done    chan struct{}
}

// NewScheduler builds a scheduler. Call Start to begin polling.
func NewScheduler(store *Store, engine *Engine) *Scheduler {
	return &Scheduler{store: store, engine: engine, interval: 30 * time.Second, running: map[string]bool{}}
}

// Start launches the polling loop. Safe to call once.
func (s *Scheduler) Start() {
	if s.store == nil || s.engine == nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	s.done = make(chan struct{})
	go s.loop(ctx)
}

// Stop halts the loop and waits for it to exit.
func (s *Scheduler) Stop() {
	if s.cancel == nil {
		return
	}
	s.cancel()
	<-s.done
}

func (s *Scheduler) loop(ctx context.Context) {
	defer close(s.done)
	// Re-anchor NextRunAt for enabled schedules on boot (covers downtime).
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

// reanchor recomputes NextRunAt for any enabled schedule that is missing one or
// whose time is far in the past (so a schedule that came due while the backend
// was down runs once, promptly, rather than being skipped or storming).
func (s *Scheduler) reanchor() {
	list, err := s.store.ListSchedules()
	if err != nil {
		return
	}
	now := time.Now()
	for _, sc := range list {
		if !sc.Enabled {
			continue
		}
		expr, err := ParseCron(sc.Cron)
		if err != nil {
			continue
		}
		if sc.NextRunAt == 0 || time.UnixMilli(sc.NextRunAt).Before(now.Add(-s.interval)) {
			if n := expr.Next(now); !n.IsZero() {
				sc.NextRunAt = n.UnixMilli()
				_ = s.store.saveScheduleRaw(sc)
			}
		}
	}
}

func (s *Scheduler) tick(ctx context.Context, now time.Time) {
	list, err := s.store.ListSchedules()
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

func (s *Scheduler) fire(ctx context.Context, sc RunSchedule) {
	defer func() {
		s.mu.Lock()
		delete(s.running, sc.ID)
		s.mu.Unlock()
	}()

	// Advance NextRunAt first so a long run can't cause a double-fire.
	if expr, err := ParseCron(sc.Cron); err == nil {
		if n := expr.Next(time.Now()); !n.IsZero() {
			sc.NextRunAt = n.UnixMilli()
		}
	}
	sc.LastRunAt = time.Now().UnixMilli()
	sc.LastError = ""

	rb, err := s.store.GetRunbook(sc.RunbookID)
	if err != nil {
		sc.LastStatus = "error"
		sc.LastError = "runbook not found"
		_ = s.store.saveScheduleRaw(sc)
		return
	}
	if !rb.Published {
		sc.LastStatus = "skipped"
		sc.LastError = "runbook is not published"
		_ = s.store.saveScheduleRaw(sc)
		return
	}
	_ = s.store.saveScheduleRaw(sc) // persist the advanced NextRunAt / LastRunAt

	// Drain the SSE channel to nothing — a scheduled run has no viewer.
	ch := make(chan sse.Message, 64)
	go func() {
		for range ch {
		}
	}()
	runCtx, cancel := context.WithTimeout(ctx, 6*time.Hour)
	defer cancel()
	runID := s.engine.Run(runCtx, rb, sc.Version, cloneArgs(sc.Args), false, "schedule", ch)
	close(ch)

	if run, err := s.store.GetRun(runID); err == nil && run != nil {
		sc.LastStatus = run.Status
		sc.LastRunID = runID
	} else {
		sc.LastStatus = StatusFailed
	}
	log.Printf("scheduler: ran %s (schedule %s) → %s", sc.RunbookID, sc.ID, sc.LastStatus)
	_ = s.store.saveScheduleRaw(sc)
}

func cloneArgs(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}
