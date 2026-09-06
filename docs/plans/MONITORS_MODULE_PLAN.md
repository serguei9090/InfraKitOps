# Monitors module — plan (BR Tier 2)

## Status: M0–M5 done — probes (icmp/tcp/http/dns/tls-cert/domain/ssh), board, alerts, policy, mute, tags, schedule runOnStart, tray, "Save as monitor", rollups + incidents + uptime reporting, public status pages, bulk import + templates + dependencies. M6 (app-layer probes) is on request only. See the Build checklist at the bottom.

- **M5 (2026-09-06)** — reporting & scale:
  - **M5a** (`0b01816`) — `rollup.go`: retention sweep folds raw→1m@24h→1h@7d
    (cut-offs bucket-aligned so each folds once), 1h pruned @90d; replaces the
    bare 5000-cap prune on the engine ticker. `monitor_rollup` +
    `monitor_incident` tables. Engine opens an incident on a down transition,
    closes on recovery. `countsSince`/`UptimeAt`/`Summary` (24h/7d/30d per
    monitor + per tag, merging raw + both rollup periods), `Incidents`,
    `Report` (uptime + MTTR + MTBF + 30d incident list), `Series`
    (auto-resolution: raw ≤25h, 1m ≤8d, else 1h; unions rollups with
    not-yet-folded raw). Endpoints `/monitors/summary`, `/{id}/incidents`,
    `/{id}/series`, `/{id}/report` (`?format=csv`). FE: row + tag uptime
    pills, 24h/7d/30d stat grid, range-selectable series chart, 30-day
    incident list, CSV/JSON export.
  - **M5b** (`0d99542`) — `statusboard.go`: `monitor_status_board`
    (owner-scoped, token-addressed). CRUD under `/monitors/status-boards` +
    `/{id}/rotate`. **Public** `GET /api/v1/status/{token}` — no auth in
    either mode (`publicPath()` in `bearerAuth`, folded into `authExempt`
    for `--auth on`); stripped payload (name/status/uptime + open incident
    timestamps). FE: standalone `/status/:token` route (no shell), Settings →
    Monitors "Status pages" group (add/delete/copy-link/rotate/toggle
    incidents).
  - **M5c** (`b58c0c5`) — `bulk.go`: `ParseBulk` (`name,kind,target[,tags]`
    lines, per-line errors) + `BuildTemplate("web-service")` (http + tls +
    dns + domain group for one hostname). `POST /monitors/{bulk,template}`.
    `Monitor.dependsOn` (ALTER, no migration) — a down transition whose
    parent is already down opens the incident `suppressed=1` and skips
    notification (still broadcast to the board). FE: "Import" dialog
    (paste / template tabs) + "Depends on" select in the editor.

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
| `tls-cert` | `tls.Dial` + parse chain | days to `notAfter` | days > `warnDays` (default 21) + trusted + host-match | `internal/tools/x509fetch` |

Plus `domain` (whois expiry) and `redis` / `runbook` / `statuspage` — see the
roadmap. `ssh` (M4) is the one that matters most day-to-day: it reuses the
`ssh_node` registry and covers disk / service / process / load / cert-file in
a single kind.

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
- **Retention**: `prune()` every ~5 min — keep the last `maxSamples`
  (default 5000) per monitor (window function, per `monitor_id`). Downsampling /
  rollups for long retention is **M5**, not v1.
- **Boot**: **resume** every `enabled=1` monitor (the opposite of `runstream`'s
  mark-interrupted — persistence is the point); `status=unknown` until the
  first probe lands.
- **Alerts**: **M1 = in-app only** — the frontend polls, notices a `down`
  transition, and raises one error-toaster line. **M3** adds real channels
  (webhook / SMTP / desktop) + a notification policy (alert-after-N-seconds,
  re-notify, recovery) + maintenance-window muting. The engine's alert sink is
  already a pluggable `func(AlertEvent)`.
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
- **Tool hooks** (M3): "Save as monitor" from Ping Monitor · X.509 Inspector ·
  DNS Lookup · Whois — each prefills the New-monitor dialog.

New deps: none through M5 (icmp/tcp/http/dns/tls/domain/ssh/redis all use
stdlib or code already vendored). A native Postgres/MySQL probe (M6) would be
the first — gated on an explicit ask.

## Day-to-day needs → roadmap

What an infra/ops person actually sets up, in the order they hit it, and which
phase delivers it. M0/M1 (done) cover ping + TCP + the board. Everything below
is a phase from here.

| Need (real words) | Probe / feature | Phase |
|---|---|---|
| "Is the site up and returning 200 fast enough" | `http` — status set, max-latency, follow-redirects | **M2** |
| "Is the health endpoint actually healthy" (`{"status":"ok"}`) | `http` — JSON dot-path assert / body keyword present‑absent | **M2** |
| "Warn me before the TLS cert expires" | `tls-cert` — days-left, default warn 21d, also flags expired / untrusted / host-mismatch | **M2** |
| "Warn me before the domain registration lapses" | `domain` — whois expiry, default warn 30d | **M2** |
| "Did someone change my DNS / is the A record still right" | `dns` — record type + expected value match, custom resolver | **M2** |
| "Tell me on Slack / email, not just a toast I'll miss" | notification channels: webhook (Slack/Discord/Teams JSON), SMTP, desktop notification | **M3** |
| "Don't page me for the 2am deploy" | maintenance windows / snooze (still probes + records, doesn't notify) | **M3** |
| "Alert after it's been down 2 min, not after 2 samples; re-ping me every 15" | notification policy: down-for ≥ N seconds, re-notify interval, recovery notice | **M3** |
| "Group prod / staging / customer-x and filter the board" | tags + board filter + per-tag "N down" | **M3** |
| "I already have this host in a Ping tab / X.509 / DNS tool" | "Save as monitor" from Ping · X.509 · DNS Lookup · Whois | **M3** |
| "Is disk > 90% / is nginx active / is the worker process alive" | `ssh` — run a command, assert exit 0 / regex / numeric compare; ships presets (disk %, service active, process running, load, mem free, cert-file expiry) | **M4** |
| "One screen for every SSH node I've registered" | node-health board — auto icmp+ssh monitor per `ssh_node`, live overview SSE | **M4** |
| "What was our uptime last month / how long was that outage" | sample rollups (raw 24h → 1‑min 7d → 1‑hour 90d), uptime %, MTTR, incident list + export | **M5** |
| "Give the team / a customer a read-only status page" | public `/status/{token}` board, per-tag | **M5** |
| "Import 40 hosts from a list; spin up a standard web-service bundle" | bulk import (CSV / newline) + templates (`http`+`tls`+`dns` created together) | **M5** |
| "Don't alert on the app if its host is already down" | monitor dependencies (parent down → suppress child) | **M5** |
| "Is Postgres / Redis actually answering" | `redis` (tcp + `PING`/`AUTH`, no dep); Postgres/MySQL via an `ssh` `psql -c 'select 1'` preset, native driver only if asked | **M6** |
| "Run my existing health-check runbook on a schedule and chart pass/fail" | `runbook` probe — run a published runbook per interval, pass = all steps ok (adds the timeseries + alert layer over cron schedules) | **M6** |
| "Is one of my cloud dependencies having an incident" | `statuspage` — poll an Atlassian Statuspage `/api/v2/status.json` | **M6** |

## Runtime models & missed-run handling

The module behaves differently depending on how the backend runs. Both are
first-class; the user picks per situation.

### Model A — hosted / always-on (`docker compose`, DEPLOY_PLAN)

The backend container runs 24/7. Monitors and cron schedules run continuously.
This is the model for anything you *rely* on — cert expiry, production uptime,
domain renewal. A restart is covered by M0 boot-resume. Alerts go out by email
(M3 SMTP) and/or webhook (M3); no desktop notification (it's a browser).

### Model B — desktop, "morning check" (Tauri sidecar)

The sidecar lives only while the app window is open. The mental model: open the
app, glance at the board / hit **Run all checks now**, confirm your dev + prod
hosts and sites are healthy, close it. Ping / TCP / HTTP here are a manual
sweep you do yourself, not a pager.

- **On app open** the engine resumes every enabled monitor **and probes each
  once immediately** (M0 already does this — `tick` fires on `Reload`, not at
  the next interval). So the board is current within a couple of seconds of
  opening.
- **Run all checks now** — one button in the board header, `POST /monitors/check-all`,
  fans a `CheckNow` across every monitor. The explicit "sweep" action. (M3.)
- **Alerts are optional here** — you're watching the screen. SMTP / webhook
  still work while the app is open (useful for a "send myself the morning
  digest" flow); desktop-notification channel only makes sense with the tray
  option below.
- **"Keep monitoring in the background"** (desktop build only, M3) — a Settings
  toggle. When on, closing the window **hides to a tray icon** instead of
  quitting; the sidecar and monitors keep running, and the desktop channel can
  raise real OS notifications. Off (default) = closing the app stops
  everything. Full "launch on login / headless service" is out of scope — if
  you want that, run Model A.

### No backlog. Run-once-on-start instead.

Desktop is explicitly **not** a catch-up system — nobody wants yesterday's
missed windows replayed when they open the app. Monitors already work this
way: on resume the engine probes each once and moves on.

The plan brings **cron schedules** (runbook R4b, ansible AN4b) in line with a
single opt-in flag:

- `RunSchedule.runOnStart` / `Schedule.runOnStart` — `bool`, default `false`
  (existing behaviour unchanged).
- When `true`: the schedule fires **once** whenever the scheduler starts (app
  open / backend boot / restart), independent of cron timing, then follows its
  normal cron. At most one fire per boot — never a storm.
- When `false`: today's behaviour — `reanchor()` skips any window missed by
  more than one poll interval (30 s) and jumps `NextRunAt` to the next future
  match. No backlog, no replay.
- Editor: a "Run once when the app / backend starts" checkbox next to the cron
  field. For a desktop "morning check" this is the main setting; the cron
  interval is then just a safety net for a long-open session.

Symmetric change to both schedulers + the two schedule models. It touches
`internal/orchestrator` and `internal/ansible`, not `internal/monitor`, but
belongs here — same "what happens on start" question. Ship in **M3**.

## Settings → Monitors panel (M3)

One section in the existing Settings registry (`registry.tsx`), same pattern
as Runbooks / Network. Shared config lives in a `monitor_settings` blob
(backend, `GET/PUT /monitors/settings`); the desktop-only tray toggle is a
client preference.

- **Alerting**
  - *Default channel*: `none` · `webhook` · `email` · `desktop` (per-monitor
    override still wins).
  - *Webhook*: URL, `format` (`slack` · `discord` · `generic`), optional
    signing header value (a `{{secret:NAME}}` Vault ref, never plaintext).
    **Send test** button → posts a sample alert.
  - *Email (SMTP)*: host, port, `security` (`none` · `starttls` · `tls`),
    username, password (Vault secret ref), `from`, `to` (comma list).
    **Send test** button.
  - *Policy defaults*: "alert after down ≥ N seconds", "re-notify every N
    minutes", "notify on recovery" (toggle). Per-monitor override in the
    monitor editor.
- **Behaviour**
  - *Pause all monitors* — master kill switch (engine `StopAll`, rows keep
    their `enabled` flag so a later un-pause restores exactly).
  - *Run all checks when the backend starts* — toggle, default on (this is the
    M0 run-on-resume; the toggle lets a large deployment opt out of a probe
    storm at boot).
  - *(desktop build)* **Keep monitoring when the window is closed** — the tray
    option above.
- **Retention**
  - Raw sample cap per monitor (default 5000). Rollup windows appear here once
    **M5** lands.

Secrets (SMTP password, webhook signing key) go through the existing Vault —
same as runbook / ansible auth — so `--auth on` gets per-user isolation for
free and nothing sensitive sits in `monitor.db`.

## Phases

### Done
- **M0** — `internal/monitor` backend: db, `Probe` iface + `icmp`/`tcp`,
  `Engine` (ticker + state machine + boot-resume + prune), `/monitors` CRUD +
  `/samples` + `/check`.
- **M1** — Frontend module: taxonomy + route + `monitorStore` + status board +
  New-monitor dialog + detail chart + in-app down-toast.

### M2 — the first-hour checks (probe kinds every setup needs)

Four new probe files, no `Engine` change (the M0 design already dispatches by
kind). Each reads its kind-specific settings from the monitor's `config_json`;
the New/Edit dialog grows a per-kind field group.

- **`http`** — method, headers (with `{{secret:NAME}}` → Vault for auth),
  expected status set (default 200–399), `maxLatencyMs` threshold, follow-
  redirects toggle, and **one** content assertion: body substring
  present / absent, or a JSON dot-path equals (`data.status == "ok"`). `value`
  = TTFB ms. Reuses `internal/executor`'s HTTP client shape + `internal/templating`.
- **`dns`** — record type (A/AAAA/CNAME/MX/TXT/NS), expected value(s), optional
  custom resolver `host:53`. `ok` = resolves **and** matches. `value` = resolve
  ms. Reuses `internal/tools/dnslookup`.
- **`tls-cert`** — `tls.Dial` + parse chain (reuse `internal/tools/x509fetch`).
  `value` = days to `notAfter`; `ok` = `value > warnDays` (default 21) **and**
  chain trusted **and** hostname matches. `detail` carries the reason on fail.
  Default `intervalSec` 3600.
- **`domain`** — whois registration expiry (reuse `internal/tools/whois`).
  `value` = days to expiry; `ok` = `> warnDays` (default 30). Default
  `intervalSec` 43200 (twice a day — registrars rate-limit whois).

### M3 — it reaches you (notifications + daily-use polish)

The alert sink stops being a log line.

- **Channels** — `internal/monitor/notify/`: `webhook` (generic JSON, works for
  Slack / Discord / Teams incoming webhooks — a `format` hint picks the body
  shape), `smtp` (stdlib `net/smtp`), `desktop` (a `monitor-alert` SSE the
  desktop app turns into an OS notification, only meaningful with the tray
  option). Config via the **Settings → Monitors panel** (spec above) backed by
  `monitor_settings` + `GET/PUT /monitors/settings`; `--monitor-*` flags +
  `INFRAKIT_*` env for headless deploys. Per-monitor channel override; a global
  default otherwise. Secrets via Vault.
- **Notification policy** (per monitor, defaults global): notify once the
  monitor has been `down` for ≥ `alertAfterSec` (wall-clock, so a flappy target
  with a low `failThreshold` doesn't spam); `renotifyEverySec` while still down;
  a recovery notification.
- **Maintenance windows** — `monitor_mute(monitor_id | tag, from, to, repeat?)`.
  A muted monitor keeps probing and recording; the engine just skips `notify()`.
  Board shows a "muted" pill.
- **Tags** — `monitor.tags TEXT` (comma list). Board: a tag filter bar + a
  per-tag `up/down` summary. `GET /monitors?tag=`.
- **`/monitors/stream`** SSE — live status-change events for the board, so it
  updates without waiting for the 10 s poll.
- **Run all checks now** — board-header button, `POST /monitors/check-all`
  (fan a `CheckNow` across the caller's monitors). The Model-B "morning sweep".
- **Schedule `runOnStart`** — `bool` on `RunSchedule` / ansible `Schedule`
  (default false); both schedulers fire it once on start, then normal cron (see
  "No backlog" above). Editor: "Run once when the app / backend starts".
- **Desktop: minimise-to-tray** — `src-tauri` tray icon + a
  `close → hide` handler gated on a `keepMonitoringInBackground` preference;
  the sidecar is no longer killed on window close when it's on. Settings toggle
  (desktop build only).
- **"Save as monitor"** buttons: Ping Monitor (one `icmp` per host), X.509
  Inspector (`tls-cert`), DNS Lookup (`dns`), Whois (`domain`). Each prefills
  the New-monitor dialog from the tool's current input.

### M4 — host-level checks (the `ssh` probe)

One probe kind that subsumes a dozen "is X on the box OK" needs.

- **`ssh`** — reuses the R2 SSH executor (`executor.SSHRun`) + the shared
  `ssh_node` registry (`orchestrator.Store.GetNode`) + Vault for the key/pass.
  Config: `nodeId` (or inline host), `command`, and an assertion —
  `exitZero` | `stdoutMatches: <regex>` | `stdoutNumber: <op> <n>` (parse the
  first number out of stdout, compare). `value` = that number, or 0/1.
- **Presets** in the dialog (fill `command` + assertion): disk % used
  (`df --output=pcent <path> | tail -1`, `< 90`), service active
  (`systemctl is-active <svc>`), process running (`pgrep -x <name>`), load-1
  (`cut -d' ' -f1 /proc/loadavg`), memory free MB, cert-file days-left
  (`openssl x509 -enddate -noout -in <file>`).
- **Node-health board** — for every registered `ssh_node`, offer a one-click
  "monitor this node" that creates an `icmp` + an `ssh` "uptime" monitor tagged
  `node:<name>`; a filtered board view groups them.

### M5 — reporting & scale (once a deployment has many monitors)

- **Rollups** — `monitor_rollup(monitor_id, bucket, period, ok_count, total,
  min, avg, max)`. A sweep folds raw samples into 1‑min buckets after 24 h and
  1‑hour buckets after 7 d; raw pruned at 24 h (was 5000-cap). Detail chart
  picks the resolution from the zoom range.
- **Uptime / incident view** — group consecutive `down`→`up` events into
  incidents (start, end, duration); a per-monitor and per-tag uptime % for
  24h / 7d / 30d; CSV / JSON export.
- **Public status page** — `GET /status/{token}` (token per board, generated in
  Settings), a stripped read-only render: per-tag component list, current
  status, 90-day uptime bar, open incidents. No auth, no data beyond
  name/status/uptime.
- **Bulk + templates** — paste newline / CSV `name,kind,target` → many monitors;
  a "standard web service" template creates `http` + `tls-cert` + `domain` +
  `dns` for one hostname in a tagged group.
- **Dependencies** — `monitor.dependsOn` (monitor id). When the parent is
  `down`, a child transition to `down` is recorded but **not** notified
  (`detail: "suppressed — <parent> is down"`).

### M6 — app-layer probes (specialized, on request)

- **`redis`** — TCP + RESP `PING` (+ `AUTH` with a `{{secret:}}`). ~20 lines, no
  dep. `value` = round-trip ms.
- **`runbook`** — run a published runbook (`orchestrator.Engine`) on the
  interval; `ok` = every step `ok`; `value` = total duration. Owner must own
  the runbook. This is the "mark a schedule as a health check" idea, delivered
  as a probe kind so it shares the board / alerting / history.
- **`statuspage`** — GET an Atlassian Statuspage `…/api/v2/status.json`;
  `ok` = `status.indicator == "none"`; `detail` = the indicator + description.
- **Postgres / MySQL** — recommended path is an `ssh` preset running
  `psql -c 'select 1'` / `mysqladmin ping` (no dep, and it tests the box's
  own connectivity). A native `pgx` / `go-sql-driver` probe only if a
  connection from the InfraKit host itself is specifically wanted — it's the
  first runtime dep the module would take, so it needs a real ask.

## Build checklist

`[x]` done · `[ ]` to build. Backend items are Go in `backend/`, frontend TS
in `app/`.

### M0 — done
- [x] `internal/monitor/{model,store,probe,engine}.go` + `probe_icmp.go` + `probe_tcp.go`
- [x] `monitor.db` schema, `prune()`, boot-resume, `seedFailStreak`, `StopAll`
- [x] `internal/api/monitor.go` — CRUD + `/samples` + `/{pause,resume,check}`
- [x] `main.go` `openMonitor` + engine `Start(ctx)` + alert-sink log
- [x] `server.go` routes, `middleware.moduleOf`→`monitor`, `capabilities.monitor`
- [x] `monitor_test.go`

### M1 — done
- [x] `core/monitor/monitorModel.ts` — types, `KINDS`, status helpers
- [x] `adapters/backend/monitorClient.ts`
- [x] `stores/monitorStore.ts` — 10s poll, down-toast
- [x] `moduleTaxonomy` `monitor` entry + `routes.tsx` + `tools/MonitorsScreen.tsx`
- [x] `adapters/ui/monitor/MonitorsScreen.tsx` — board + detail + New/Edit dialog

### M2 — probe kinds (backend) — done
- [x] `probe_tls.go` — `x509fetch.Fetch` + parse `notAfter`; value = days; ok = `>warnDays` (21) & trusted & host-match; default interval 3600
- [x] `probe_domain.go` — `whois.Query`; parse `ExpirationDate` across registrar layouts; value = days; ok = `>warnDays` (30); default interval 43200; ctx-guarded
- [x] `probe_http.go` — `net/http` (method, headers, redirects toggle, timeout); value = response ms; status set / `maxLatencyMs` / body-contains / body-absent / `executor.EvalDotPath` JSON assert. *(headers `{{secret:}}` → M3 with Vault wiring)*
- [x] `probe_dns.go` — `dnslookup.Query` (type, resolver); ok = resolves & every `expected` present; value = resolve ms
- [x] `model.go` — `kindDefaultInterval`; `cfgBool/cfgFloat/cfgStrings`; `KnownKind` + handler rejects unknown kind
- [x] `probe_test.go` — hermetic http (httptest), tls (httptest self-signed), pure `statusAllowed`/`parseExpiry`; dns skips w/o network

### M2 — frontend — done
- [x] `monitorModel.ts` — `domain` kind; `KindMeta.defaultIntervalSec` + `configFields` (ConfigField descriptors); `configSummary()`
- [x] `MonitorsScreen` `<ConfigInput>` — generic per-kind field group; kind switch pulls default interval + clears stale config; detail shows the summary line

### M3 — notifications (backend) — done
- [x] `internal/monitor/notify.go` — `Notifier` (webhook slack/discord/generic + SMTP none/starttls/tls + `{{secret:}}` via Vault; `desktop` = the SSE)
- [x] `settings.go` — per-owner `Settings` blob (`monitor_settings`), `GET/PUT /monitors/settings` (secrets redacted) + `POST /monitors/settings/test`
- [x] schema: `monitor.tags / channel / alert_after_sec / renotify_every_sec / muted_until`
- [x] `monitor.muted_until` + `POST /monitors/{id}/{mute,unmute}` + engine skip
- [x] engine: `loopState` + `applyNotifyPolicy` (alert-after wall-clock, re-notify, recovery, restart-safe `alerted` seed); async `fire()`
- [x] `GET /monitors?tag=` · `POST /monitors/check-all` · `GET /monitors/stream` (Engine.Subscribe/broadcast)
- [x] `--monitor-webhook` / `INFRAKIT_MONITOR_WEBHOOK` fallback; Vault resolver wired in main.go

### M3 — schedules (backend) — done
- [x] `RunSchedule.RunOnStart` / ansible `Schedule.RunOnStart` (JSON blob — no migration)
- [x] both schedulers: `runOnStart(ctx)` after `reanchor()` in `loop()` — fire enabled runOnStart schedules once/boot; missed windows still skipped

### M3 — Tauri — done (cargo check/test green; tray behaviour needs a desktop build to hand-verify)
- [x] `tray-icon` feature; tray icon + Show/Quit menu + left-click show
- [x] `KeepAlive` state + `set_keep_alive` command; `on_window_event` CloseRequested → `prevent_close` + `hide` when set
- [x] sidecar still killed on real quit (ExitRequested unchanged)

### M3 — frontend — done
- [x] `monitorStore` — settings state + load/save/test; `/monitors/stream` consumed while board open (down → toast + refresh); `tagFilter`; `checkAll`/`mute`/`unmute`; `pendingNew`/`requestNew`/`consumeNew`
- [x] `monitorClient` — settings CRUD, test, checkAll, mute/unmute, `openMonitorStream`, `listMonitors(tag?)`
- [x] `MonitorSettings.tsx` + `registry.tsx` "monitors" entry — channel / webhook / SMTP / policy / probe-on-start / desktop keep-alive; Send test
- [x] `MonitorsScreen` — tag filter bar, "Run all checks now", "muted" pill (row + detail), Snooze 1h / Unmute, Tags + Alert-channel in the editor
- [x] runbook + ansible `SchedulesView` — "Run once when the app / backend starts" switch
- [x] `SaveAsMonitorButton` — X.509 "Watch expiry" + Ping "Save as monitor" (DNS / Whois: same one-liner, deferred)
- [x] `desktopKeepAlive.ts` — localStorage pref + `invoke('set_keep_alive')`, re-synced on boot; the `monitor-alert` SSE toast already covers desktop notification wiring for now

### M4 — `ssh` probe — done
- [x] `probe_ssh.go` — `executor.SSHRun` + `monitor.SetNodeResolver` (main.go, from the orchestrator `ssh_node` registry + Vault) or inline host+user; `evalSSHAssert` grammar `exit0 | contains: | matches: | num:<op><n>`; value = parsed number or latency ms; unit tests
- [x] api: `target` optional for `ssh` when `config.nodeId` set
- [x] FE: `ssh` kind + `SSH_PRESETS`; bespoke `<SshConfig>` in the dialog (node picker via `listNodes`, preset dropdown, command, assert)
- [x] FE: Runbooks → Nodes row "Monitor" button → an ssh `true` check tagged `node: <name>`
- [ ] *(deferred)* a dedicated `node:` board group view — tag filter already covers it

### M5 — reporting & scale — done
- [x] `monitor_rollup` table + fold sweep (1-min @24h, 1-hour @7d) + raw prune at 24h + 1h prune @90d
- [x] `monitor_incident` table; engine open-on-down / close-on-recovery; `GET /monitors/{id}/incidents`
- [x] uptime % per window (24h/7d/30d) per-monitor + per-tag (`/monitors/summary`); `GET /monitors/{id}/report` + `?format=csv`; MTTR + MTBF
- [x] `GET /monitors/{id}/series?period=auto|raw|1m|1h` — chart resolution
- [x] `monitor_status_board` table (token) + `GET /api/v1/status/{token}` (no auth both modes, stripped) + CRUD + rotate
- [x] `POST /monitors/bulk` + `POST /monitors/template` ("web-service")
- [x] `monitor.depends_on` + engine suppression (incident `suppressed=1`, no notify)
- [x] FE: range-selectable series chart; incident list; report CSV/JSON export; `/status/:token` standalone route; Settings "Status pages" group; Import dialog (paste + template); "Depends on" select

### M6 — app-layer (on request)
- [ ] `probe_redis.go` (TCP + RESP PING/AUTH)
- [ ] `probe_runbook.go` (`orchestrator.Engine`, ok = all steps ok)
- [ ] `probe_statuspage.go` (`…/api/v2/status.json`)
- [ ] FE: redis / runbook / statuspage field groups
- [ ] *(only if asked)* native Postgres/MySQL probe — first runtime dep

## Not doing

- A full TSDB — SQLite + a capped ring per monitor is right for a single-binary
  single-replica deployment. Prometheus/Grafana already ship as a compose
  overlay (`deploy/compose.observability.yml`) for the app's *own* metrics;
  this is for the user's targets, at a human scale (tens of monitors, not
  thousands).
- Distributed / multi-location probing.
- Paging integrations (PagerDuty etc.) beyond a generic webhook.
