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

	alerts   func(AlertEvent) // optional, set by SetAlertSink (a log line)
	notifier *Notifier        // optional, set by SetNotifier (webhook / email)
}

// NewEngine wires the engine to its store.
func NewEngine(store *Store) *Engine {
	return &Engine{store: store, loops: map[string]context.CancelFunc{}}
}

// SetAlertSink registers a callback fired on a down / recovered transition.
func (e *Engine) SetAlertSink(fn func(AlertEvent)) { e.alerts = fn }

// SetNotifier wires the alert delivery path (M3). The notification *policy*
// (alert-after-N-seconds, re-notify) is applied per monitor loop.
func (e *Engine) SetNotifier(n *Notifier) { e.notifier = n }

// loopState is a monitor loop's running state — kept out of the DB.
type loopState struct {
	fails      int
	downSince  time.Time
	alerted    bool
	lastNotify time.Time
}

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
	s, _ := e.tick(ctx, m.ID, &loopState{})
	return s
}

func (e *Engine) runLoop(ctx context.Context, id string) {
	cur, err := e.store.Get("", id)
	if err != nil || cur == nil || !cur.Enabled {
		return
	}
	interval := time.Duration(cur.IntervalSec) * time.Second

	st := &loopState{fails: seedFailStreak(e.store, id, cur.FailThreshold)}
	// Don't re-alert on a monitor that was already down before this restart.
	if cur.Status == StatusDown {
		st.alerted = true
		st.downSince = time.UnixMilli(cur.LastChangeAt)
		st.lastNotify = time.Now()
	}

	t := time.NewTicker(interval)
	defer t.Stop()

	e.tick(ctx, id, st) // probe immediately on (re)start
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if _, keep := e.tick(ctx, id, st); !keep {
				return // monitor gone / disabled
			}
		}
	}
}

// tick runs one probe + state machine for monitor id. keep is false when the
// loop should stop (monitor deleted / disabled).
func (e *Engine) tick(ctx context.Context, id string, st *loopState) (sample Sample, keep bool) {
	m, err := e.store.Get("", id)
	if err != nil || m == nil || !m.Enabled {
		e.Stop(id)
		return Sample{}, false
	}

	s := runProbe(ctx, *m)
	if s.OK {
		st.fails = 0
	} else {
		st.fails++
	}

	newStatus := m.Status
	switch {
	case s.OK:
		newStatus = StatusUp
	case st.fails >= m.FailThreshold:
		newStatus = StatusDown
	}

	changed := newStatus != m.Status
	if err := e.store.recordCheck(id, s, newStatus, changed); err != nil {
		obs.Warnf("monitor %s: record failed: %v", id, err)
	}

	// A real up<->down transition → the log sink.
	if changed && e.alerts != nil &&
		(newStatus == StatusDown || (newStatus == StatusUp && m.Status == StatusDown)) {
		ev := "recovered"
		if newStatus == StatusDown {
			ev = "down"
		}
		e.alerts(AlertEvent{Monitor: *m, Event: ev, At: s.T, Detail: s.Detail})
	}

	if e.notifier != nil {
		e.applyNotifyPolicy(m, newStatus, s, st)
	}
	return s, true
}

// applyNotifyPolicy fires webhook / email alerts subject to the alert-after and
// re-notify settings (per monitor, falling back to the owner's global).
func (e *Engine) applyNotifyPolicy(m *Monitor, newStatus string, s Sample, st *loopState) {
	set, _ := e.store.GetSettings(m.Owner)
	after := m.AlertAfterSec
	if after == 0 {
		after = set.AlertAfterSec
	}
	renotify := m.RenotifyEverySec
	if renotify == 0 {
		renotify = set.RenotifyEverySec
	}
	now := time.UnixMilli(s.T)

	switch newStatus {
	case StatusDown:
		if st.downSince.IsZero() {
			st.downSince = now
		}
		switch {
		case !st.alerted && now.Sub(st.downSince) >= time.Duration(after)*time.Second:
			e.fire(m, "down", s.Detail)
			st.alerted, st.lastNotify = true, now
		case st.alerted && renotify > 0 && now.Sub(st.lastNotify) >= time.Duration(renotify)*time.Second:
			e.fire(m, "down", s.Detail)
			st.lastNotify = now
		}
	case StatusUp:
		if st.alerted && set.NotifyOnRecovery {
			e.fire(m, "recovered", s.Detail)
		}
		st.downSince, st.alerted, st.lastNotify = time.Time{}, false, time.Time{}
	}
}

// fire delivers one alert asynchronously so a slow SMTP server can't stall the
// probe loop.
func (e *Engine) fire(m *Monitor, event, detail string) {
	mon := *m
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := e.notifier.Send(ctx, mon, event, detail); err != nil {
			obs.Warnf("monitor %q: alert (%s) failed: %v", mon.Name, event, err)
		}
	}()
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
