package auth

import (
	"sync"
	"time"
)

// throttle is an in-memory failed-login limiter keyed by "username|ip".
// Exponential backoff: the Nth consecutive failure blocks retries for
// min(2^(N-3) seconds, cap). A success clears the key.
type throttle struct {
	mu      sync.Mutex
	entries map[string]*attempt
	cap     time.Duration
	now     func() time.Time // swappable in tests
}

type attempt struct {
	fails     int
	blockedTo time.Time
}

func newThrottle() *throttle {
	return &throttle{
		entries: map[string]*attempt{},
		cap:     15 * time.Minute,
		now:     time.Now,
	}
}

// allowed reports whether a login attempt for key may proceed right now.
func (t *throttle) allowed(key string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	e := t.entries[key]
	if e == nil {
		return true
	}
	return !t.now().Before(e.blockedTo)
}

// fail records a failed attempt and extends the block window.
func (t *throttle) fail(key string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	e := t.entries[key]
	if e == nil {
		e = &attempt{}
		t.entries[key] = e
	}
	e.fails++
	if e.fails >= 3 {
		d := time.Duration(1<<uint(e.fails-3)) * time.Second
		if d > t.cap || d <= 0 {
			d = t.cap
		}
		e.blockedTo = t.now().Add(d)
	}
}

// ok clears the counter after a successful login.
func (t *throttle) ok(key string) {
	t.mu.Lock()
	delete(t.entries, key)
	t.mu.Unlock()
}

// sweep drops entries whose block has long expired (bounded memory).
func (t *throttle) sweep() {
	t.mu.Lock()
	defer t.mu.Unlock()
	cut := t.now().Add(-time.Hour)
	for k, e := range t.entries {
		if e.blockedTo.Before(cut) {
			delete(t.entries, k)
		}
	}
}
