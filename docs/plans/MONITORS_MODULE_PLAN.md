# Monitors module — plan (BR Tier 2)

## Status: M0 + M1 done (icmp/tcp probes + status board). M2–M4 pending.

- **M0 (2026-09-05)** — `internal/monitor`: `monitor.db` (`--monitor-db`),
  `Probe` iface + `icmp`/`tcp`, `Engine` (ticker per monitor, fail-threshold
  state machine, `seedFailStreak` across restarts, 5-min prune, boot-resume of
  enabled monitors, `StopAll` on shutdown), `MonitorHandlers` (CRUD + samples +
  pause/resume/check), owner-scoped, `moduleOf`→`monitor`, `capabilities.monitor`,
  alert sink → `obs` log. `go test` green.
- **M1 (2026-09-05)** — `core/monitor/**` model + kind metadata, `monitorClient`,
  `monitorStore` (10 s poll, in-app toast on a *down* transition — recovery just
  flips the dot, M2's webhook does real notification both ways), `monitor` rail
  module (`hideToolPane`, RadioTower), `MonitorsScreen` status board (list +
  detail chart reusing `LatencyChart` + recent-checks log + New/Edit dialog).
  Verified in-browser: create → up/down cycle → detail history → alert lands in
  the error drawer.

## Why

Tier 1 (`pingMonitorStore`, `befa13e`) keeps a ping session alive across in-app
navigation. It still dies on a full reload or from another device, because the
run lives in the browser.

**Tier 2** is server-side persistent monitoring: a small check that runs on the
backend forever, keeps a history you can come back to hours later or from
another machine, and alerts when a target goes down or a cert is about to
expire. This is *not* the same as `runstream` (BACKGROUND_RUNS_PLAN.md) — that's
for finite jobs that end. A monitor never ends, produces an unbounded sample
stream, and needs a rolling window, not replay-all.

## Which modules want Tier 2

**Direct probe kinds — build these:**

| Kind | Probe | `value` | up/down | Reuses |
|---|---|---|---|---|
| `icmp` | ICMP echo | RTT ms | reply within timeout, N fails → down | `internal/tools/ping` (`ping.Echo`) |
| `tcp` | `net.DialTimeout` | connect ms | connection accepted | stdlib |
| `http` | GET, follow redirects | TTFB ms | 2xx/3xx (+ optional expected status / body substring) | stdlib |
| `dns` | `LookupHost` | 0/1 | resolves (+ optional expected address) | `internal/tools/dnslookup` |
| `tls-cert` | `tls.Dial` + parse chain | days to `notAfter` | days > `warnDays` (default 14) | `internal/tools/x509fetch` |

**Indirect / later:**

- **SSH nodes** (Runbooks + Ansible already share `ssh_node`) — "are my
  registered control targets reachable" — icmp or an ssh-handshake probe per
  node. The targets are already registered; a Node-health board is the most
  natural infra-uptime view. → **M3**
- **Runbook / Ansible health checks** — run a runbook/playbook on an interval
  and track pass/fail as a timeseries + alert on N consecutive fails. Overlaps
  the existing cron schedules (R4b / AN4b), which already fire on a schedule —
  Tier 2 would add *result history as a series* + *alerting* ("mark this
  schedule as a health check"). → **M4, optional**

**Modules that do NOT need Tier 2:** AI Hub, config builders, formatters,
Prompt Library, FormFlow, Knowledge Hub, most utilities. And every *finite*
job — traceroute, scans, iperf, one-shot ansible/runbook runs — those are
`runstream`-shaped (BR1–3), not monitor-shaped.

## Design — one subsystem, pluggable probes, one board

`internal/monitor` owns every monitor kind. A **Monitors module** gives the
unified "what's my infra doing" board. Individual tools create monitors of
their kind via a button ("Save as monitor" on Ping, "Watch expiry" on X.509) —
shared infra, unified view, tool integration.

### Backend `internal/monitor/`

- **`monitor.db`** (new sibling DB, `--monitor-db` / `INFRAKIT_MONITOR_DB`,
  under `--data-dir`):
  - `monitor(id TEXT PK, owner, name, kind, target, interval_sec, timeout_sec,
    config_json, enabled INT, fail_threshold INT, status TEXT, last_checked_at,
    last_change_at, created_at)` — `status` ∈ `up | down | unknown | paused`
  - `monitor_sample(monitor_id, t INT, ok INT, value REAL, detail TEXT)`,
    index `(monitor_id, t DESC)`
- **`Probe` interface**: `Kind() string; Probe(ctx, Monitor) Sample` where
  `Sample{OK bool; Value float64; Detail string}`. One file per kind.
- **`Engine`**: one goroutine per enabled monitor, `time.Ticker(interval)`.
  Each tick: probe under a `timeout_sec` context → append sample → state
  machine:
  - `fail_threshold` consecutive fails → `status=down`, stamp `last_change_at`,
    emit `alert{event:"down"}`
  - first ok after down → `status=up`, emit `alert{event:"recovered"}`
  - `SetEnabled(id,bool)` starts/stops a goroutine; `Reload(id)` on edit.
- **Retention**: `PruneSamples` every ~5 min — keep the last `maxSamples`
  (default 5000) per monitor. Downsampling / rollups for long retention is
  **M4**, not v1.
- **Boot**: **resume** every `enabled=1` monitor (the opposite of `runstream`'s
  mark-interrupted — persistence is the point); `status=unknown` until the
  first probe lands.
- **Alerts**: **v1 in-app only** — the row's `status` + `last_change_at`, the
  frontend surfaces a badge + one error-toaster line on transition. **M2**:
  `--monitor-webhook` (POST `{monitor,event,at,detail}`, reuses `obs`'s webhook
  plumbing).
- **Endpoints**: `/monitors` (GET/POST), `/monitors/{id}` (GET/PUT/DELETE),
  `/monitors/{id}/samples?since=&limit=`, `/monitors/{id}/{pause,resume}`,
  `/monitors/{id}/check` (run one probe now), `/monitors/stream` (SSE, live
  status changes for the board), `/monitors/{id}/stream` (SSE, live samples for
  the open detail chart). `capabilities.monitor` + supported probe kinds (icmp
  may need elevation on Windows — reuse the ping capability check).
- Owner-scoped; `--auth on` → per-user monitors; `auth.Service.OnUserDeleted`
  purges.

### Frontend

- `src/core/monitor/**` framework-free — model, kind metadata, status helpers.
- `monitorClient.ts` + `monitorStore.ts` — poll `/monitors` ~10 s; open
  `/monitors/{id}/stream` only for the detail view in front of the user.
- `moduleTaxonomy` id `monitor`, route `/tools/monitors`, rail icon.
- **T8 "Status board"** scaffold: left = monitor list (name · status dot ·
  mini-sparkline · last check · interval); right = detail (timeseries chart via
  the existing `LatencyChart`, up/down event log, edit form). Header "New
  monitor" dialog (kind → target → interval → alert threshold).
- **Tool hooks**: Ping Monitor → "Save as monitor" (one `icmp` monitor per
  host); X.509 Inspector → "Watch expiry" (`tls-cert` monitor).

New deps: none.

## Phases

- **M0** — `internal/monitor`: db, `Monitor` model, `Probe` iface + `icmp` +
  `tcp`, `Engine` (ticker + state machine + boot-resume + prune), `/monitors`
  CRUD + `/samples` + `/check`. `go test ./...`.
- **M1** — Frontend module: taxonomy + route + `monitorStore` + status-board
  scaffold + New-monitor dialog + detail chart. In-app status surfacing +
  error-toaster on transition.
- **M2** — `http` + `dns` + `tls-cert` probes; `--monitor-webhook`; Ping "Save
  as monitor" + X.509 "Watch expiry".
- **M3** — SSH-node health board (probe the shared `ssh_node` registry);
  `/monitors/stream` live overview.
- **M4** *(optional)* — sample downsampling / rollups for 90-day retention;
  runbook/playbook health-check monitors; maintenance windows (mute).

## Not doing

- A full TSDB — SQLite + a capped ring per monitor is right for a single-binary
  single-replica deployment. Prometheus/Grafana already ship as a compose
  overlay (`deploy/compose.observability.yml`) for the app's *own* metrics;
  this is for the user's targets, at a human scale (tens of monitors, not
  thousands).
- Distributed / multi-location probing.
- Paging integrations (PagerDuty etc.) beyond a generic webhook.
