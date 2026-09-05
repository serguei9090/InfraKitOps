# Ping Monitor — add/remove targets mid-session (plan)

## Status: not started

Multi-host concurrent ping already exists and works — `internal/tools/ping.Monitor`
spawns one goroutine per host, the frontend already renders a combined
`LatencyChart` + one `HostCard` per host, and (as of `26e0fa2`) the chart has a
legend with a per-host show/hide toggle. What's missing: once a session is
**running**, the Host(s) field is inert — editing it does nothing until you hit
Stop (which discards every host's accumulated chart history) and Start again.
This plan adds the ability to add or remove a single host from an in-progress
session without losing the others' history.

## Design decision: reconnect, not a live session (Option A)

Two designs were weighed:

- **Option A — reconnect with the full host list (chosen).** Adding/removing a
  host recomputes the complete host list and calls `start()` again — the same
  `GET /ping-monitor/stream?hosts=...` call any query-parameter change already
  triggers everywhere else in this app. The frontend keeps each *pre-existing*
  host's `points`/`stats` in `tracksMap` across the reconnect instead of
  wiping it, so the chart shows no gap. **Zero backend changes.**
- **Option B — true incremental, no reconnect.** The backend would need a
  session concept: an id returned over SSE, a companion `POST` endpoint to
  push add/remove instructions into a specific in-flight `Monitor()` call, and
  per-host goroutine cancellation. This is the objectively more correct design
  for a 24/7 NOC-style dashboard where uninterrupted uptime counters matter —
  but it introduces a one-off stateful-session pattern this codebase has
  nowhere else (every other tool is reconnect-on-change), for a benefit that
  doesn't matter for how Ping Monitor is actually used today: an interactive
  foreground diagnostic session, not a long-running SLA tracker.

**Chosen: Option A.** Cost, stated plainly: each add/remove resets every
still-running host's small counters (consecutive up/down streak, sent/recv
totals, jitter EWMA) to zero for a moment, because the backend spins up a
fresh `Monitor()` call — a new set of `hostState` structs. The chart's
time-series history does **not** reset; that lives client-side in
`tracksMap` and is explicitly preserved. If Ping Monitor ever grows into an
always-on background monitor rather than an interactive session, revisit
Option B then — not before.

## Implementation

Frontend-only, `app/src/adapters/ui/tools/PingMonitorScreen.tsx`.

1. **`preserveOnStart` ref** (`useRef(false)`). Set to `true` immediately
   before an add/remove-triggered `start()` call; read once inside `onStart`
   then reset to `false`.
2. **`onStart` callback**: currently rebuilds `tracksMap` from scratch on
   every `start()`. Branch on `preserveOnStart.current`:
   - `false` (the existing "Start" button, not streaming) → today's full
     reset, unchanged.
   - `true` (add/remove while streaming) → merge: keep every existing
     `HostTrack` whose host is still in the new list, add a fresh empty
     track for any newly-added host, drop tracks for removed hosts.
3. **`addHost(host: string)`**: trim/validate, no-op if blank or already
   present (case-sensitive exact match is fine — same as how `hostsText` is
   split today). Append to `hostsText` (keeps it as the single source of
   truth the existing `hosts` `useMemo` already derives from), set the
   preserve flag, call the same param-building logic `run()` uses with the
   now-updated `hosts` list.
4. **`removeHost(host: string)`**: filter `host` out of `hostsText`;
   synchronously delete its entry from `tracksMap` (so its card/line
   disappear immediately, not after the reconnect round-trip). If any hosts
   remain: set the preserve flag and restart. If none remain: call `stop()`
   instead — nothing left to stream.
5. **UI**:
   - A compact "+ Add host" control, shown only while `streaming` — a small
     text input + button near the query bar (not the main "Host(s)" field,
     which stays the pre-start configuration surface).
   - A small remove ("×") affordance in each `HostCard`'s header, next to
     the up/down badge, shown only while `streaming` (removing while
     stopped is just editing the text field, no new control needed there).
6. **Verify in-browser** (not just build-clean): start 2 hosts, add a 3rd
   mid-run — confirm the first 2 keep their chart lines with no visible gap
   and the 3rd starts fresh; remove one — confirm its card/line vanish
   immediately and the rest keep running uninterrupted.

## Files

`app/src/adapters/ui/tools/PingMonitorScreen.tsx` only. No backend, no new
routes, no taxonomy/route changes (same tool, same `toolId`).

## Effort

S — a few focused hours. No new dependencies, no new backend surface.

## Explicitly out of scope

- Per-host independent interval/downThreshold — all hosts in one session
  share one interval, same as today.
- Option B (true incremental backend) — documented above as a deliberate
  "not now," not dropped silently.
