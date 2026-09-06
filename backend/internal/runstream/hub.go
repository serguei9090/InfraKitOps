// Package runstream decouples a long-running job ("run") from the HTTP request
// that starts it. A run is registered with the Hub, which owns its cancel func,
// an append-only NDJSON event log on disk, and any number of live subscribers.
// Closing a viewing connection ends that subscription; it does not cancel the
// run. See docs/plans/BACKGROUND_RUNS_PLAN.md.
package runstream

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/infrakit/backend/internal/sse"
)

// Key identifies a run: the module that owns it and that module's DB row id.
type Key struct {
	Module string // "ansible" | "runbook"
	ID     int64
}

func (k Key) String() string { return k.Module + "/" + strconv.FormatInt(k.ID, 10) }

// Meta is the human-facing summary shown in the global "Runs" panel.
type Meta struct {
	Owner  string `json:"owner"`
	Target string `json:"target"` // playbook path / runbook name
}

// Info is one row of GET /runs/active.
type Info struct {
	Module    string `json:"module"`
	ID        int64  `json:"id"`
	Owner     string `json:"owner"`
	Target    string `json:"target"`
	Status    string `json:"status"`
	StartedAt int64  `json:"startedAt"`
}

// record is one persisted line of a run's NDJSON log.
type record struct {
	Seq   int    `json:"seq"`
	T     int64  `json:"t"`
	Event string `json:"event"`
	Data  any    `json:"data"`
}

// Hub owns every in-flight run. One instance per process.
type Hub struct {
	dir string

	mu   sync.Mutex
	runs map[Key]*run
}

type sub struct {
	ch      chan sse.Message
	dropped chan struct{}
}

type run struct {
	key     Key
	meta    Meta
	cancel  context.CancelFunc
	started time.Time

	mu      sync.Mutex
	seq     int
	status  string // "" while running; terminal string once closed
	log     *os.File
	subs    map[int]*sub
	nextSub int
}

// New returns a Hub storing per-run logs at <baseDir>/runs/<module>/<id>.ndjson.
func New(baseDir string) *Hub {
	return &Hub{dir: filepath.Join(baseDir, "runs"), runs: map[Key]*run{}}
}

func (h *Hub) logPath(k Key) string {
	return filepath.Join(h.dir, k.Module, strconv.FormatInt(k.ID, 10)+".ndjson")
}

// Start registers a run and returns the emit func its goroutine calls for every
// SSE event — emit appends to the log and fans out to live subscribers. cancel
// is invoked by Cancel / CancelAll.
func (h *Hub) Start(key Key, meta Meta, cancel context.CancelFunc) (func(ev string, data any), error) {
	p := h.logPath(key)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return nil, err
	}
	r := &run{key: key, meta: meta, cancel: cancel, started: time.Now(), log: f, subs: map[int]*sub{}}

	h.mu.Lock()
	if old := h.runs[key]; old != nil {
		old.close("superseded")
	}
	h.runs[key] = r
	h.mu.Unlock()

	return r.emit, nil
}

// Finish flushes + closes the run's log, drops its subscribers (clean EOF) and
// removes it from the active set. status is informational (the terminal state
// is authoritative in the module's own run table).
func (h *Hub) Finish(key Key, status string) {
	h.mu.Lock()
	r := h.runs[key]
	delete(h.runs, key)
	h.mu.Unlock()
	if r != nil {
		r.close(status)
	}
}

// Cancel invokes a run's cancel func. Returns false if the run isn't active.
func (h *Hub) Cancel(key Key) bool {
	h.mu.Lock()
	r := h.runs[key]
	h.mu.Unlock()
	if r == nil {
		return false
	}
	r.cancel()
	return true
}

// CancelAll cancels every active run — used on graceful shutdown.
func (h *Hub) CancelAll() {
	h.mu.Lock()
	rs := make([]*run, 0, len(h.runs))
	for _, r := range h.runs {
		rs = append(rs, r)
	}
	h.mu.Unlock()
	for _, r := range rs {
		r.cancel()
	}
}

// Active lists the currently-running runs, newest first.
func (h *Hub) Active() []Info {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]Info, 0, len(h.runs))
	for k, r := range h.runs {
		out = append(out, Info{
			Module: k.Module, ID: k.ID, Owner: r.meta.Owner,
			Target: r.meta.Target, Status: "running", StartedAt: r.started.UnixMilli(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt > out[j].StartedAt })
	return out
}

// IsActive reports whether a run is currently in flight.
func (h *Hub) IsActive(key Key) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.runs[key] != nil
}

// HasLog reports whether a persisted event log exists for key (active or not).
func (h *Hub) HasLog(key Key) bool {
	_, err := os.Stat(h.logPath(key))
	return err == nil
}

// Remove deletes a run's event log from disk (retention sweeps).
func (h *Hub) Remove(key Key) error {
	err := os.Remove(h.logPath(key))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

// Subscribe replays the run's whole persisted log to out, then — if the run is
// still active — forwards live events until the run ends or ctx is done. out is
// closed on return. Subscribe never cancels the run.
func (h *Hub) Subscribe(ctx context.Context, key Key, out chan<- sse.Message) {
	defer close(out)

	h.mu.Lock()
	r := h.runs[key]
	h.mu.Unlock()

	if r == nil { // finished or unknown — replay whatever is on disk
		h.replayFile(ctx, key, 0, out)
		return
	}

	// Attach under the run lock so we miss no event: snapshot seq, add the sub.
	r.mu.Lock()
	if r.status != "" {
		r.mu.Unlock()
		h.replayFile(ctx, key, 0, out)
		return
	}
	from := r.seq
	s := &sub{ch: make(chan sse.Message, 512), dropped: make(chan struct{})}
	id := r.nextSub
	r.nextSub++
	r.subs[id] = s
	r.mu.Unlock()

	defer func() {
		r.mu.Lock()
		delete(r.subs, id)
		r.mu.Unlock()
	}()

	if !h.replayFile(ctx, key, from, out) {
		return
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-s.dropped:
			return
		case m, ok := <-s.ch:
			if !ok {
				return // run finished
			}
			select {
			case out <- m:
			case <-ctx.Done():
				return
			}
		}
	}
}

// replayFile streams the persisted log for key. When upTo > 0 only records with
// seq <= upTo are sent. Returns false if ctx ended mid-replay.
func (h *Hub) replayFile(ctx context.Context, key Key, upTo int, out chan<- sse.Message) bool {
	f, err := os.Open(h.logPath(key))
	if err != nil {
		return true // nothing persisted yet
	}
	defer f.Close()

	dec := json.NewDecoder(f)
	for dec.More() {
		var rec record
		if err := dec.Decode(&rec); err != nil {
			break
		}
		if upTo > 0 && rec.Seq > upTo {
			break
		}
		select {
		case out <- sse.Message{Event: rec.Event, Data: rec.Data}:
		case <-ctx.Done():
			return false
		}
	}
	return true
}

func (r *run) emit(ev string, data any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.status != "" {
		return
	}
	r.seq++
	if b, err := json.Marshal(record{Seq: r.seq, T: time.Now().UnixMilli(), Event: ev, Data: data}); err == nil {
		_, _ = r.log.Write(append(b, '\n'))
	}
	msg := sse.Message{Event: ev, Data: data}
	for id, s := range r.subs {
		select {
		case s.ch <- msg:
		default: // slow consumer — drop it, its client reconnects + replays
			close(s.dropped)
			delete(r.subs, id)
		}
	}
}

func (r *run) close(status string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.status != "" {
		return
	}
	r.status = status
	_ = r.log.Close()
	for _, s := range r.subs {
		close(s.ch) // clean EOF; the run-end event was already emitted
	}
	r.subs = nil
}
