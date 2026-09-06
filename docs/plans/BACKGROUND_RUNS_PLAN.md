# Background runs — plan

## Status: BR1–BR3 + Ping Tier 1 done. BR4 (server-side monitors) not started.

- **BR1 (2026-09-05)** — `internal/runstream` hub + Ansible wired. Playbook,
  job and ad-hoc runs execute under a request-independent context registered
  with the hub; the old `GET …/run/stream` endpoints now start a *background*
  run and replay+tail it (survives navigation), and there are new
  `POST /ansible/{projects/{id},jobs/{id},adhoc}/run` → `{runId}` plus
  module-agnostic `GET /runs/active`, `GET /runs/{module}/{id}/stream`,
  `POST /runs/{module}/{id}/cancel`. Boot recovery marks orphaned
  `running`/`awaiting_approval` rows `interrupted`; graceful shutdown
  cancels in-flight runs. Synchronous fallback kept for when the hub is
  absent (tests / `--ansible-db off`). Frontend still uses the GET stream —
  BR3 switches it.
- **BR2 (2026-09-05)** — Runbooks wired to the same hub. `orchestrator.Engine`
  `Run` takes an `orchestrator.Emitter` (not a chan); `redactWriter` too;
  split `prepareRun` (BuildPreview + validate + secret args + InsertRun +
  preview/run-start) / `executeRun` (concurrency slot + approval gate + step
  loop + finish). `StartBackground` buffers the pre-hub preview/run-start
  events, registers with the hub under a detached user-scoped context, runs
  in a goroutine. `GET /runbooks/{id}/run/stream` now background+replay-tails
  for **real** runs (dry runs stay synchronous — nothing to persist); new
  `POST /runbooks/{id}/run` → `{runId}`. `RunsHandlers` handles module
  `"runbook"` (owner check + step-by-step DB replay for pre-hub runs).
  `orchestrator.Store.MarkRunningInterrupted()` + boot recovery in main.go.
  Scheduler passes a no-op emitter.
- **BR3 (2026-09-05)** — frontend. `runsClient` (`listActiveRuns` /
  `openRunStream` / `cancelRun`) + `runsStore` (adaptive poll of
  `/runs/active` — 4s busy / 20s idle, paused when the backend is down).
  Global **Runs drawer** in the shell header (`adapters/ui/runs/RunsDrawer`,
  mirrors the error-history drawer) — spinner + count badge, hidden when
  nothing runs; rows show target · module · status · elapsed, cancel, and
  re-attach. `{Ansible,Runbook}ConsoleScaffold` consume a drawer
  `attachRequest` on mount / on change and call `store.attachRun(id)` →
  opens `/runs/{module}/{id}/stream`, whose replay rebuilds the tree/step
  list before tailing. runbook event-folding extracted to a shared
  `runStreamHandlers`. Stop buttons (`RunView`, `RunPanel`) now
  `cancelLiveRun()` → `POST /runs/{id}/cancel` (a bare SSE abort no longer
  stops the run). **Routing note**: the `/runs/{id}/stream|cancel` routes
  carry `?module=` as a query param — chi requires one param name (`{id}`)
  at that tree position and the runbook `/runs/{id}` route already owns it.
  Executor fix rode along: `cmd.WaitDelay = 3s` so a cancelled shell step
  whose grandchild holds the stdout pipe still returns promptly.
  Verified in-browser end-to-end.

## Problem

Ansible and Runbook runs are **bound to the HTTP request that started them**:

```go
// internal/api/ansible.go, internal/api/runbook.go
ctx, cancel := context.WithCancel(r.Context())
go func() { h.Engine.Run(ctx, ...); close(ch) }()
sw.Pump(ctx, ch)
```

Navigate away from the run screen → the browser drops the SSE stream →
`r.Context()` cancels → `runner.Stream(ctx, …)` kills the `ansible-playbook` /
step subprocess. The run **dies**.

So you cannot: start a playbook, go look at ping/traceroute while it runs,
come back and check status + logs. Every other "workbench" (Semaphore, AWX,
Rundeck) treats a run as a server-side object the browser just *views*. That's
what this adds.

Secondary win: it also relieves the browser's 6-connections-per-origin HTTP/1.1
limit — a "running now" panel polls one cheap endpoint, and you only hold a
full `/stream` open for the one run you're actively watching.

## Design

**Decouple the run from the connection.** A run is started by a `POST` that
returns a `runId` and kicks off a goroutine with its **own** context (not the
request's). To watch it, open `GET /runs/{runId}/stream` — a *replay + tail*
stream. Closing it stops watching, not the run.

### `internal/runstream` — the shared primitive

A module-agnostic hub + per-run append-only log. One package, used by both
Ansible (BR1) and Runbooks (BR2), and later anything else that streams.

```go
type Hub struct { … }               // process-wide, one instance in main.go

// Start registers a run: opens its log file, stores its cancel func, returns
// the emit fn the run goroutine calls for every event. emit appends the
// message to the log AND fans it out to live subscribers.
func (h *Hub) Start(key RunKey, cancel context.CancelFunc) (emit func(sse.Message))

// Finish flushes + closes the log, marks the run terminal, drops subscribers.
func (h *Hub) Finish(key RunKey, status string)

// Subscribe streams the whole persisted log, then (if still active) live
// events, until the run ends or the caller's ctx is done. Never cancels the run.
func (h *Hub) Subscribe(ctx context.Context, key RunKey, w *sse.Writer) error

func (h *Hub) Cancel(key RunKey) bool          // calls the stored cancel func
func (h *Hub) Active() []RunInfo               // for GET /runs/active
```

- `RunKey` = `{module string, id int64}` (`"ansible"`/`"runbook"` + the row id).
- **Log storage**: `<data-dir>/runs/<module>/<id>.ndjson`, one JSON object per
  line: `{"seq":N,"t":<unixMs>,"event":"…","data":…}`. Covers *everything* —
  `run-start`, `ansible-*` / step events, `stdout`, `stderr`, `run-end`. Replay
  = stream the file back as SSE. (Ansible's callback NDJSON file stays an
  internal detail of the runner; the hub log is the unified record.)
- **Metadata** (status, times, owner, target) stays in each module's existing
  run table — `ansible_run`, `run`. No schema change beyond a new status value.
- **Fan-out**: `map[RunKey][]chan sse.Message`, bounded buffers, a slow
  subscriber is dropped (its viewport reconnects and replays).

### Run lifecycle

- Context: `ctx, cancel := context.WithTimeout(context.Background(), maxRunDur)`
  — **not** from `r.Context()`. `maxRunDur` from settings (default e.g. 6 h,
  `0` = no cap). `cancel` handed to `hub.Start`.
- `POST /ansible/projects/{id}/run` (and job / runbook equivalents) —
  `InsertRun` → `hub.Start` → `go engine.Run(ctx, …, emit)` → return `{runId}`
  immediately. (The old `GET …/run/stream` handlers are replaced by the POST +
  the shared `GET /runs/{key}/stream`.)
- `POST /runs/{module}/{id}/cancel` → `hub.Cancel` → the run's own ctx is
  cancelled → subprocess killed → `Finish(…, "cancelled")`.
- **Graceful shutdown**: on `SIGTERM`, cancel all active runs, `Finish` them
  `interrupted`, flush logs. (Configurable "let them finish" later if wanted.)
- **Boot recovery**: on start, `UPDATE …_run SET status='interrupted' WHERE
  status IN ('running','awaiting_approval')` — those goroutines died with the
  old process. Their partial log file is still on disk and replayable.
- **Retention**: prune `runs/<module>/*.ndjson` for run rows older than the
  module's retention window / beyond its keep count (`runbook_settings` +
  a matching `ansible` knob already exist for the metadata; extend to the log).

### New status value

Add `interrupted` (process died mid-run) alongside `running` / `ok` /
`failed` / `cancelled` / `awaiting_approval`. Distinct from `cancelled` (a
user asked) so the UI can say "the backend restarted".

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/ansible/projects/{id}/run` | start; returns `{runId}` |
| `POST` | `/ansible/jobs/{id}/run` | start a job run; returns `{runId}` |
| `POST` | `/runbooks/{id}/run` | start; returns `{runId}` |
| `GET` | `/runs/{module}/{id}/stream` | replay + tail (SSE) |
| `POST` | `/runs/{module}/{id}/cancel` | cancel |
| `GET` | `/runs/active` | `[{module,id,target,status,startedAt,owner}]` for the panel |

`/runs/*` is owner-scoped (both run tables have `owner`); admin reassign is
unchanged; approvals unchanged; `--max-concurrent-runs` still caps/queues at
the engine.

### Frontend

- **`runsStore`** (Zustand) — polls `GET /runs/active` every ~5 s; holds
  active + recently-finished runs.
- **Global "Runs" drawer** in the shell — same pattern as the existing
  error-history drawer. Row = module icon · target · status · elapsed ·
  "view". Header badge with the active count.
- **Module run flow** — the "Run" button `POST`s, gets `runId`, opens the
  run view. Navigating away leaves the run going.
- **Shared run-view component** — takes `{module, runId}`, opens
  `/runs/{module}/{id}/stream`. Because the stream *replays*, this one
  component covers both "watch a live run" and "open a finished run from
  history" — the current separate `replayEvents` history path collapses into
  it.
- `useNetworkStream`'s unmount-abort (added in `9656bb0`) stays for the
  genuinely foreground network tools — they're out of scope here (see below).

## Scope / phases

| | |
|---|---|
| **BR1** | `internal/runstream` + wire **Ansible** (`Run`, `RunAdhoc`, job runs). POST-to-start, `/runs/ansible/{id}/stream`, cancel, `/runs/active`, boot recovery, shutdown handling. Ansible is the smaller lift — it already accumulates the full event blob; mostly a matter of writing it incrementally through the hub instead of once at the end, and moving `ctx` off the request. |
| **BR2** | Wire **Runbooks** (`orchestrator.Engine.Run`) to the same hub. The engine emits `sse.Message`s already; route them through `emit`. |
| **BR3** | Frontend — `runsStore`, the global Runs drawer, the shared run-view, rewire the Ansible + Runbook screens. Merge the history-replay path into the run-view. |
| **BR-T1** *(done 2026-09-05)* | **Ping Monitor Tier 1** — run state (hosts, tracks, SSE) hoisted from the screen into `pingMonitorStore`; no unmount teardown, so a session survives *in-app* navigation with a gap-free chart. `PING` sample stream stays one SSE. Not server-side. |
| **BR4** *(not started — different product)* | Server-side continuous **monitors** surviving a full reload / other device: rolling-window storage (not replay-all), multiple named monitors, thresholds/alerts. This is uptime monitoring for production hosts, not troubleshooting — its own plan, own lifecycle, own registry (not `runstream`). Only if there's demand. |

Network Toolkit one-shot / short tools (traceroute, scans, DNS, whois, iperf)
stay foreground — they finish in seconds and a leaked stream is already
handled by the unmount-abort. Not worth a run record.

## Risks

- **Orphaned subprocesses.** The whole point is the run outlives the request,
  so cancellation must be airtight: the run's own ctx (with `maxRunDur`),
  `hub.Cancel`, shutdown cancel-all, and boot recovery all have to be right or
  a bad path leaves `ansible-playbook` / an SSH exec running. Test each:
  normal finish, user cancel, `maxRunDur` timeout, SIGTERM mid-run, hard kill
  + reboot.
- **Disk.** Per-run NDJSON logs grow (a chatty `-vvv` playbook, a long
  runbook). Cap per-run log size (truncate with a marker line), prune on
  retention, and surface total `runs/` size in Settings.
- **Head-of-line on a busy hub.** One process fanning many runs to many
  viewers. Bounded per-subscriber channels + drop-slow-and-let-it-reconnect.
- **Thin test coverage.** `internal/sse` has no tests; the stream handlers are
  barely covered. `internal/runstream` gets real unit tests (start → emit →
  subscribe replays → finish → subscribe replays terminal; cancel; boot
  recovery). Every wired module needs a manual end-to-end pass.
- **Migration of the run-stream contract.** `GET …/run/stream` handlers go
  away; the frontend must switch to POST-then-`/runs/{…}/stream` in the same
  release. The history-replay endpoints (`replayEvents`) fold into the new
  stream — verify old stored runs still replay (their event blob is in the
  DB, not a log file; the stream handler falls back to the DB blob when no
  log file exists).

## Not doing

- An external job queue (Redis / Temporal) — breaks the single-binary,
  no-new-dep model. In-process hub + SQLite + a logs dir is right for the
  single-replica deployment.
- WebSocket / a multiplexed SSE bus — solves connection *count*, not
  run-survives-navigation. Orthogonal; the registry is the actual need.
- Cross-user run visibility beyond the existing owner/admin model.
