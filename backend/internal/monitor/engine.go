package monitor

import (
	"context"
	"sync"
	"time"

	"github.com/infrakit/backend/internal/obs"
)

// Engine runs one goroutine per enabled monitor and keeps monitor.db in sync.
type Engine struct {
	store *Store

	mu    sync.Mutex
	loops map[string]context.CancelFunc // monitor id → stop
	root  context.Context               // process lifetime, set by Start

	alerts func(AlertEvent) // optional, set by SetAlertSink
}

// NewEngine wires the engine to its store.
func NewEngine(store *Store) *Engine {
	return &Engine{store: store, loops: map[string]context.CancelFunc{}}
}

// SetAlertSink registers a callback fired on a down / recovered transition.
func (e *Engine) SetAlertSink(fn func(AlertEvent)) { e.alerts = fn }

// Start resumes every enabled monitor and runs the retention sweep until ctx
// ends. Call once from main.go.
func (e *Engine) Start(ctx context.Context) {
	e.mu.Lock()
	e.root = ctx
	e.mu.Unlock()

	enabled, err := e.store.ListEnabled()
	if err != nil {
		obs.Warnf("monitor: boot resume failed: %v", err)
	} else {
		for _, m := range enabled {
			e.Reload(m)
		}
		if len(enabled) > 0 {
			obs.Infof("monitor: resumed %d monitor(s)", len(enabled))
		}
	}

	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := e.store.prune(); err != nil {
					obs.Warnf("monitor: prune failed: %v", err)
				}
			}
		}
	}()
}

// Reload (re)starts a monitor's loop, or stops it when the monitor is disabled.
// Call after every create / edit / pause / resume.
func (e *Engine) Reload(m Monitor) {
	e.Stop(m.ID)
	if !m.Enabled {
		return
	}
	e.mu.Lock()
	root := e.root
	if root == nil {
		root = context.Background()
	}
	ctx, cancel := context.WithCancel(root)
	e.loops[m.ID] = cancel
	e.mu.Unlock()
	go e.runLoop(ctx, m.ID)
}

// Stop ends a monitor's loop if running.
func (e *Engine) Stop(id string) {
	e.mu.Lock()
	if cancel, ok := e.loops[id]; ok {
		cancel()
		delete(e.loops, id)
	}
	e.mu.Unlock()
}

// StopAll ends every loop — graceful shutdown.
func (e *Engine) StopAll() {
	e.mu.Lock()
	for id, cancel := range e.loops {
		cancel()
		delete(e.loops, id)
	}
	e.mu.Unlock()
}

// CheckNow runs a single probe for m, records it + any transition, and returns
// the sample. Used by POST /monitors/{id}/check.
func (e *Engine) CheckNow(ctx context.Context, m Monitor) Sample {
	s, _ := e.tick(ctx, m.ID, nil)
	return s
}

func (e *Engine) runLoop(ctx context.Context, id string) {
	cur, err := e.store.Get("", id)
	if err != nil || cur == nil || !cur.Enabled {
		return
	}
	interval := time.Duration(cur.IntervalSec) * time.Second
	fails := seedFailStreak(e.store, id, cur.FailThreshold)

	t := time.NewTicker(interval)
	defer t.Stop()

	e.tick(ctx, id, &fails) // probe immediately on (re)start
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if _, keep := e.tick(ctx, id, &fails); !keep {
				return // monitor gone / disabled
			}
		}
	}
}

// tick runs one probe + state machine for monitor id. `fails` is the loop's
// running consecutive-failure count (nil for a one-off CheckNow, which reseeds).
// keep is false when the loop should stop (monitor deleted / disabled).
func (e *Engine) tick(ctx context.Context, id string, fails *int) (sample Sample, keep bool) {
	m, err := e.store.Get("", id)
	if err != nil || m == nil || !m.Enabled {
		e.Stop(id)
		return Sample{}, false
	}

	local := 0
	if fails == nil {
		local = seedFailStreak(e.store, id, m.FailThreshold)
		fails = &local
	}

	s := runProbe(ctx, *m)
	if s.OK {
		*fails = 0
	} else {
		*fails++
	}

	newStatus := m.Status
	switch {
	case s.OK:
		newStatus = StatusUp
	case *fails >= m.FailThreshold:
		newStatus = StatusDown
	}

	changed := newStatus != m.Status
	if err := e.store.recordCheck(id, s, newStatus, changed); err != nil {
		obs.Warnf("monitor %s: record failed: %v", id, err)
	}

	if changed && e.alerts != nil {
		if newStatus == StatusDown || (newStatus == StatusUp && m.Status == StatusDown) {
			ev := "recovered"
			if newStatus == StatusDown {
				ev = "down"
			}
			m.Status = newStatus
			m.LastChangeAt = s.T
			e.alerts(AlertEvent{Monitor: *m, Event: ev, At: s.T, Detail: s.Detail})
		}
	}
	return s, true
}

// seedFailStreak counts trailing failures in a monitor's recent history so a
// backend restart doesn't reset a "down" monitor's streak.
func seedFailStreak(store *Store, id string, threshold int) int {
	samples, err := store.Samples("", id, 0, threshold+2)
	if err != nil || len(samples) == 0 {
		return 0
	}
	n := 0
	for i := len(samples) - 1; i >= 0; i-- {
		if samples[i].OK {
			break
		}
		n++
	}
	return n
}
