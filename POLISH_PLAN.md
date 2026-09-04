# POLISH_PLAN.md — post-observability cleanup

Six non-blocking items from the 2026-09-03 production review. The app is
feature-complete and ~8/10 prod-ready; these raise it and remove rough edges.
None gates a team deployment.

Order (recommended): **PL1 → PL3 → PL6 → PL5 → PL2 → PL4.**

---

## PL1 — DB backup automation ✅ DONE (`<pl1>`)

Landed: `internal/backup` (`Snapshot` — `VACUUM INTO` per `*.db` + verbatim
`vault.enc` + per-user vaults + `manifest.json`, tar.gz; `Prune`;
`Scheduler`), `--backup-dir` / `--backup-interval` / `--backup-keep`
(+ `INFRAKIT_*`), timer + graceful-shutdown snapshot, admin-only
`POST /api/v1/admin/backup`. Dockerfile/compose add a **separate** `/backups`
volume + `INFRAKIT_BACKUP_DIR`. DEPLOY.md restore procedure. `backup_test`:
snapshot → queryable copy, prune keeps N, empty-dir errors. Verified live:
3s-interval archives written + pruned to keep=2, archive contents valid.

**Now.** `DEPLOY.md` documents a manual "stop the container, `tar` the `/data`
volume, start it". A hot `tar` can tear the WAL. The image has no `sqlite3`
CLI. State = 5 SQLite files (`history.db`, `orchestrator.db`, `llm.db`,
`ansible.db`, `auth.db`) + `vault.enc` (encrypted blob), all under
`--data-dir`.

**Build.** The backend snapshots itself on a timer — no CLI, no stop.

- `internal/backup/backup.go`:
  - `Snapshot(dataDir, outDir string) (string, error)` — for each `*.db`
    under `dataDir`, open it and run `VACUUM INTO '<outDir>/<name>-<RFC3339>.sqlite'`
    (atomic, consistent even with live writers, pure-Go via `modernc.org/sqlite`).
    Copy `vault.enc` verbatim. Write a `manifest.json` (files + sizes +
    schema versions). `tar.gz` the set → `infrakit-backup-<ts>.tgz`.
  - `Prune(outDir string, keep int)` — delete oldest archives beyond `keep`.
  - `Scheduler` — `time.Ticker`, first run after `interval`, `slog` each
    snapshot + failure (also feeds the error webhook on failure).
- **Flags** (+ `INFRAKIT_*`): `--backup-dir` (default `""` = disabled),
  `--backup-interval` (default `24h`), `--backup-keep` (default `7`).
- `main.go`: start the scheduler when `--backup-dir` set; `defer` a final
  snapshot on graceful shutdown (best-effort).
- **Restore** = documented: stop, extract the `.tgz` into `--data-dir`
  (overwriting), start. Migrations are forward-only — a snapshot only
  restores onto the same-or-older binary.
- `deploy/compose.yml`: `--backup-dir /data/backups` + a second named volume
  or bind mount for off-box copy; `.env.example` note.
- `internal/api`: **admin-only** `POST /api/v1/admin/backup` → run a snapshot
  now, return the archive path (for an ad-hoc backup before an upgrade).

**Files.** `internal/backup/{backup,scheduler,backup_test}.go`, `main.go`,
`internal/api/admin.go` (new, tiny), `internal/server/server.go` (1 route),
`DEPLOY.md`, `Dockerfile`/`compose.yml`.

**Verify.** `backup_test`: write rows → `Snapshot` → open the snapshot DB →
rows present; `Prune` keeps N. Live: `--backup-dir` + `--backup-interval 5s`,
watch archives appear + prune; restore one into a fresh `--data-dir` and boot.

**Effort.** ~0.5 day. **No new deps** (`archive/tar`, `compress/gzip` stdlib).

---

## PL2 — FormFlow: id-based front-end repo ✅ DONE (`<pl2>`)

Landed: `ISchemaRepository` → entry-based (`list(): SchemaEntry[]`,
`load(id)`, `save(id|null, name, json) → id`, `delete(id)`). Local repo
id-keyed (`formflow_index` + `formflow_form_<id>`) with a one-time migration
of the pre-PL2 `formflow_template_*` keys on first `list()`/`save()`.
`BackendSchemaRepository` drops the `"(shared)"` suffix hack — `shared` is a
flag. `FormFlowBuilderScreen` + `AppSidebar` use `?t=<id>`, show the name +
a "shared" badge, hide delete on shared forms. `schemaRepository.test.ts`:
id round-trip, rename-in-place, migration (idempotent). **Verified in
browser**: real prefixed old keys migrate on page load, sidebar shows the
form, clicking opens `?t=form_<uuid>`.

**Now.** `ISchemaRepository` is name-keyed (`load(name)`, `save(name)`,
`?t=<name>` URL). The backend (`formstore`) is id-keyed; `schemaRepository.ts`'s
`BackendSchemaRepository` bridges name↔id and lists a shared form as
`"nginx (shared)"`. Fragile: name collisions across owners, suffix parsing,
`?t=` ambiguity.

**Build.** Make the whole path id-first.

- **Port** `ISchemaRepository` →
  ```ts
  interface SchemaEntry { id: string; name: string; canEdit: boolean; shared: boolean; owner?: string }
  interface ISchemaRepository {
    list(): Promise<SchemaEntry[]>
    load(id: string): Promise<string | null>
    save(id: string | null, name: string, json: string): Promise<string> // returns id
    delete(id: string): Promise<void>
  }
  ```
- **Local repo** — id-keyed too: `formflow_index` = `{id,name}[]`, per-form
  `formflow_form_<id>`. **One-time migration** on first `list()`: if the old
  `formflow_template_names` + `formflow_template_<name>` keys exist, convert
  each to `{id: form_<uuid>, name}` and delete the old keys.
- **Backend adapter** — drop the ` (shared)` suffix hack; `shared` is just a
  flag.
- **`FormFlowBuilderScreen`** + **`AppSidebar`** saved-list — `?t=<id>`,
  render `name` + a "shared" badge; the mode picker keys off `id`.
- Delete `ownedFormId()` (replaced by `list()` entries carrying `id`).

**Files.** `core/ports/ISchemaRepository.ts`, `adapters/storage/schemaRepository.ts`,
`adapters/backend/formClient.ts`, `adapters/ui/tools/FormFlowBuilderScreen.tsx`,
`adapters/ui/shell/AppSidebar.tsx`, `adapters/ui/share/ShareDialog` callers.

**Verify.** New `schemaRepository.test.ts` — local migration from old keys,
id round-trip. In-browser (multi-user): two users each save "nginx" → both
list cleanly with distinct ids; share one → the other sees it badged, opens
by id.

**Effort.** ~1 day. **Recommendation:** only if FormFlow sharing sees real
use — the current bridge works.

---

## PL3 — front-end component-test infrastructure + `<ErrorBoundary>` test ✅ DONE (`<pl3>`)

Landed: dev deps `@testing-library/react` + `@testing-library/dom` +
`happy-dom`. `.test.tsx` files opt into a DOM with a
`// @vitest-environment happy-dom` docblock (no config change — `test.projects`
/ `environmentMatchGlobs` avoided; the node suite is untouched, same runtime).
`ErrorBoundary.test.tsx` — renders children clean, shows the fallback +
Reload + calls `reportError` on a child throw, recovers on `resetKeys` change.
85 test files / 1339 tests green.

**Now.** Zero component tests. All 1336 tests are core `.test.ts` on the
`node` vitest environment (`vite.config.ts` → `environment: 'node'`). No
`@testing-library/react`, no DOM.

**Build.**

- devDeps: `@testing-library/react`, `@testing-library/dom`, `happy-dom`
  (lighter + faster than jsdom, first-class vitest support).
- `vite.config.ts`: `test.environmentMatchGlobs: [['**/*.test.tsx', 'happy-dom']]`
  — `.test.tsx` gets a DOM, `.test.ts` stays `node` (no slowdown to the
  existing suite).
- `src/test/setup.tsx` (optional) — RTL cleanup, any global mocks.
- **`ErrorBoundary.test.tsx`** — a child that throws → assert the fallback
  copy + a "Reload" button; flip `resetKeys` → children re-render; assert
  `reportError` was called (mock `errorStore`).
- CI (`frontend.yml`) already runs `bun run test` — picks the new file up
  automatically.

**Files.** `package.json`, `vite.config.ts`, `src/test/setup.tsx`,
`src/adapters/ui/errors/ErrorBoundary.test.tsx`.

**Verify.** `bun run test` green including the new `.test.tsx`; the node
suite runtime unchanged.

**Effort.** ~2 h. **Value:** unlocks component testing for the whole app,
not just this one file. **New deps:** 3 dev-only.

---

## PL4 — Grafana dashboard + Prometheus config ✅ DONE (`<pl4>`)

Landed (config only, no repo code): `deploy/prometheus.yml` (scrape
`/api/v1/metrics` with a bearer `credentials_file`), `deploy/grafana/dashboards/infrakit.json`
(8 panels — request rate, 5xx rate, latency p50/p95/p99, in-flight,
goroutines, heap, uptime, build), `deploy/grafana/provisioning/*`,
`deploy/compose.observability.yml` (overlay: `prometheus:` + `grafana:` on
`:3000`). `DEPLOY.md` "full metrics stack" subsection.
`docker compose -f compose.yml -f compose.observability.yml config` valid;
dashboard JSON + provisioning YAML validated.

**Now.** `/api/v1/metrics` exposes the series; names are in `DEPLOY.md`; no
turnkey dashboard. **Not application code** — config for two sidecar apps.

**Build.**

- `deploy/prometheus.yml` — a scrape job for
  `https://<host>/api/v1/metrics` with `authorization` /
  `bearer_token_file` (single-user token, or a long-lived session token in
  multi-user), `scheme: https`, `tls_config` for the self-signed case.
- `deploy/grafana/infrakit.json` — a Grafana dashboard model, ~10 panels:
  - request rate `sum(rate(infrakit_http_requests_total[5m])) by (method)`
  - 5xx rate `sum(rate(infrakit_http_requests_total{code=~"5.."}[5m]))`
  - latency p50/p95/p99
    `histogram_quantile(0.95, sum(rate(infrakit_http_request_duration_seconds_bucket[5m])) by (le))`
  - in-flight `infrakit_http_in_flight`
  - goroutines / heap `infrakit_goroutines`, `infrakit_mem_alloc_bytes`
  - uptime `time() - infrakit_start_time_seconds`
  - build info table `infrakit_build_info`
- `deploy/grafana/provisioning/` — datasource + dashboard auto-load files.
- `deploy/compose.observability.yml` — overlay adding `prometheus:` +
  `grafana:` services (+ their volumes); run with
  `docker compose -f compose.yml -f compose.observability.yml up -d`.
- `DEPLOY.md` — an "Optional: full metrics stack" subsection.

**Files.** `deploy/prometheus.yml`, `deploy/grafana/infrakit.json`,
`deploy/grafana/provisioning/{datasources,dashboards}/*.yml`,
`deploy/compose.observability.yml`, `DEPLOY.md`.

**Verify.** `docker compose -f compose.yml -f compose.observability.yml up`
→ Grafana on `:3000`, datasource green, the dashboard renders with live
data after ~1 min of scraping. Generate traffic (`for i in …; curl`) and
watch the panels move.

**Effort.** ~2–3 h (writing + testing against a real Grafana). **No repo
deps** (Prometheus/Grafana are container images). **Recommendation:** low —
do it for a turnkey handoff, skip if operators build their own.

---

## PL5 — `errorStrings.ts` — decide i18n or not ✅ DONE (`<pl5>`) — Option A

Reworded the file comment: no longer promises an i18n layer that doesn't
exist; states the app is English-only and full i18n is a separate multi-week
effort. No code change — the file is live and correct as-is.

**Now.** `core/errors/errorStrings.ts` is **live code** — `appError.ts`
imports `ERROR_STRINGS` / `RETRYABLE_CODES` / `STICKY_CODES` to build its
presets. It is *structured* for a future i18n layer (one file to translate)
but ships only English, and the file comment promises an i18n layer that
doesn't exist.

**Option A — keep, reword (10 min).** Change the doc comment from "a future
i18n layer only has to translate this file" to "all user-facing error copy
in one place (translate here if i18n is ever added)". Nothing else. The
structure is genuinely useful even without i18n.

**Option B — actually add i18n (weeks).**
- A `t()` layer — `react-i18next`, or a ~50-line custom hook since the app
  is small (new dep either way).
- `errorStrings.ts` → `locales/en.ts` + `locales/<lang>.ts`.
- Settings → language switcher, persisted via the settings-sync blob, sets
  `<html lang>`.
- Thread `t()` through **every** user-facing string across the 44 tools +
  shell + dialogs — hundreds of strings. This is the real cost.

**Recommendation: Option A.** No real multi-language requirement is on the
table; a half-translated app is worse than a clean English one. Do B only
if a customer/market demands it, and scope it as its own multi-week plan.

**Files (A).** `core/errors/errorStrings.ts` (comment only).

**Effort.** A: 10 min. B: multi-week, separate plan.

---

## PL6 — load test ✅ DONE, run 2026-09-04

Landed: `loadtest/` — k6 scripts `static.js` (SPA + hashed asset throughput),
`api-read.js` (authed GET rising-RPS ramp), `sse.js` (concurrent held streams
+ leak check), `write-contention.js` (ramp VUs on `PUT /prompts/{id}` until
`SQLITE_BUSY`/5xx → the Postgres-trigger number). `README.md` (how to run,
token, metrics sampling alongside), `RESULTS.md`. **No CI workflow** — GH
runners are 2-core, the numbers would mislead.

**Run 2026-09-04**, against the real prod Dockerfile image via `docker compose
-f compose.yml -f compose.loadtest.yml` (new local-only override, publishes
8080 directly, skips Caddy/TLS) on Docker Desktop's Linux VM (8 vCPU), k6 as
a sibling container on the same compose network. Full numbers + raw k6 JSON
in `loadtest/RESULTS.md` / `loadtest/out-*.json`. Headline:

- **Static + health**: no ceiling found at tested load (~1600 req/s, p99
  21ms / 6ms).
- **SSE**: 200 concurrent held streams, 0 errors, no goroutine/mem leak on
  disconnect (16 goroutines idle before and after).
- **Writes**: 0 `SQLITE_BUSY`/5xx up to 80 concurrent writers / 469
  writes/s — didn't find the SQLite ceiling, Postgres isn't a near-term
  need on write volume.
- **Real finding**: `GET /api/v1/runbooks` degrades hard under concurrent
  load (p95 3.9s vs `/health`'s 1.5ms), causing dropped k6 iterations at
  high RPS. Traced to an N+1 in `orchestrator.ListRunbooks`
  (`backend/internal/orchestrator/store.go:228` — per-row `GetRunbook` +
  `SharedAccess` instead of a batch query). Flagged as a follow-up task,
  not fixed here (out of scope for a load-test run).

**Now.** Never run. The SSE connection ceiling and the SQLite single-writer
throughput ceiling are unknown — the latter is what decides *when* Postgres
becomes necessary.

**Build.** `loadtest/` with **k6** scripts (JS, good HTML/JSON reports):

1. `static.js` — SPA shell + `/assets/*` at rising RPS; throughput + p99.
2. `api-read.js` — bootstrap a user, then a cheap authed `GET`
   (`/api/v1/health`, `/runbooks`) at 50 → 500 → 1000 RPS; p95/p99 vs RPS,
   error rate, goroutine/heap drift (`/metrics` sampled alongside).
3. `sse.js` — open N concurrent runbook/AI `/stream` connections
   (10 → 50 → 200), hold 60 s; watch `infrakit_http_in_flight`, goroutines,
   memory. Confirms `--max-concurrent-runs` behaviour + no leak on client
   disconnect.
4. `write-contention.js` — M concurrent `PUT /prompts/{id}` /
   `PUT /forms/{id}`; ramp M until `SQLITE_BUSY` / 5xx appears
   (`busy_timeout` is 5 s). **This number is the headline output.**

- `loadtest/README.md` — how to run (`k6 run …`), against what
  (`docker compose up` on a Linux host — Windows SQLite perf differs).
- `loadtest/RESULTS.md` — filled after a run: max sustainable RPS, SSE
  connection ceiling, the write ceiling, and a one-line "Postgres needed
  when write RPS > X or users > Y".
- Optional: a `.github/workflows/loadtest.yml` (manual dispatch only, not
  on every push — it needs a beefy runner and minutes).

**Files.** `loadtest/{static,api-read,sse,write-contention}.js`,
`loadtest/README.md`, `loadtest/RESULTS.md` (stub), optional workflow.

**Verify.** The scripts run clean against a local `docker compose`; RESULTS
gets real numbers on a Linux host.

**Effort.** ~1 day to write + a run. **Execution needs a Linux box** —
scripts can be written here, the numbers can't. **No repo deps** (k6 is a
standalone binary).

---

## Summary — ALL DONE, PL6 run 2026-09-04

| # | Item | Status |
|---|---|---|
| PL1 | DB backup automation | ✅ `internal/backup`, flags, admin endpoint, compose volume |
| PL2 | FormFlow id-based FE | ✅ entry-based repo + migration, browser-verified |
| PL3 | Component-test infra + ErrorBoundary test | ✅ RTL + happy-dom, per-file docblock, 3 tests |
| PL4 | Grafana dashboard + Prometheus config | ✅ config files + compose overlay + DEPLOY.md |
| PL5 | errorStrings comment reword | ✅ |
| PL6 | Load test — run for real | ✅ k6 scripts + `docker compose` run on Docker Desktop's Linux VM, real numbers in `loadtest/RESULTS.md` — found+flagged an N+1 in `ListRunbooks`, no SQLite write ceiling hit |

Frontend 1341 tests / 86 files green, backend all green, no new runtime deps
(3 dev-only for PL3).
