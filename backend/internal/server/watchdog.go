package server

import (
	"context"
	"os"
	"sync/atomic"
	"time"
)

// Watchdog shuts the process down when the parent app is no longer around:
//   - no request received within IdleTimeout, or
//   - the ParentPID process has exited.
//
// Both are belt-and-braces on top of Tauri killing the sidecar on window close
// (see NETWORK_MODULE_PLAN.md §2.1). A zero IdleTimeout / ParentPID disables
// that check.
type Watchdog struct {
	IdleTimeout time.Duration
	ParentPID   int

	lastActivity atomic.Int64 // unix nanos
}

// NewWatchdog returns a watchdog and primes its activity clock.
func NewWatchdog(idleTimeout time.Duration, parentPID int) *Watchdog {
	wd := &Watchdog{IdleTimeout: idleTimeout, ParentPID: parentPID}
	wd.Touch()
	return wd
}

// Touch records that a request just arrived. Safe for concurrent use; wire it
// as server.Options.OnActivity.
func (wd *Watchdog) Touch() {
	wd.lastActivity.Store(time.Now().UnixNano())
}

// Run blocks until a shutdown condition is met or ctx is cancelled, then
// returns. The caller then triggers a graceful server shutdown.
func (wd *Watchdog) Run(ctx context.Context) {
	if wd.IdleTimeout <= 0 && wd.ParentPID <= 0 {
		<-ctx.Done()
		return
	}

	tick := 2 * time.Second
	if wd.IdleTimeout > 0 && wd.IdleTimeout < tick {
		tick = wd.IdleTimeout
	}
	t := time.NewTicker(tick)
	defer t.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if wd.IdleTimeout > 0 {
				idle := time.Since(time.Unix(0, wd.lastActivity.Load()))
				if idle >= wd.IdleTimeout {
					return
				}
			}
			if wd.ParentPID > 0 && !processAlive(wd.ParentPID) {
				return
			}
		}
	}
}

// processAlive reports whether a process with the given PID currently exists.
func processAlive(pid int) bool {
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// On Unix FindProcess always succeeds; Signal(0) probes liveness. On
	// Windows FindProcess itself fails for a dead PID, so reaching here means
	// it is alive.
	return signalZero(p)
}
