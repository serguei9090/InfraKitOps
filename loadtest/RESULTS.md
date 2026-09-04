# Load test results

**Run 2026-09-04**, against `docker compose -f compose.yml -f compose.loadtest.yml`
(the real prod Dockerfile image, `--auth on`, sqlite, no code changes) on
Docker Desktop's Linux VM — 8 vCPU / 32 GB allocated to the VM, single
container, no CPU/mem limits set on the container itself. k6 ran as a
sibling container (`grafana/k6`) on the same compose network, so numbers
exclude WAN latency; treat absolute req/s as an upper bound, not a promise
for an internet-facing deployment.

| Test | Target env | Date | Result |
|---|---|---|---|
| `static.js` | docker (Linux VM, 8 vCPU) | 2026-09-04 | max sustained: **~1600 req/s**, 0% errors · p99 **21ms** (threshold was <500ms) |
| `api-read.js` | docker (Linux VM, 8 vCPU) | 2026-09-04 | **before fix**: p95 3.9s, 50,015 dropped iterations · **after fix**: p95 **34ms**, 304 dropped iterations, throughput 541→1051 req/s. See "First finding + fix" below |
| `sse.js` | docker (Linux VM, 8 vCPU) | 2026-09-04 | held **200 concurrent** streams with 0% errors, p95 **581ms**. Post-run: goroutines back to **16** (idle baseline), in-flight back to **1** — no leak on disconnect |
| `write-contention.js` | docker (Linux VM, 8 vCPU) | 2026-09-04 | **0** rejected / **0** `SQLITE_BUSY` / **0** 5xx up to **80 concurrent writers**, sustained **469 writes/s**, p95 **216ms** (one outlier at 4.75s, resolved inside the 5s `busy_timeout`, never surfaced as an error). Ceiling not found — 80 VUs was the top of the ramp, not the breaking point |

## First finding + fix: `GET /runbooks` p95 3.9s under load

The initial `api-read.js` run found `/runbooks` degrading hard under
concurrent load (p95 **3.9s** vs `/health`'s p95 1.5ms), dropping 50,015 k6
iterations at the 1000 req/s target stage — with **zero runbooks in the
table**, ruling out row count as the cause.

Two real bugs found and fixed, in order of actual impact:

1. **Dominant cause — `auth.LookupSession` sliding the session's expiry on
   every single authenticated request** (`backend/internal/auth/store.go`).
   `auth.db` is opened with `SetMaxOpenConns(1)`; every non-exempt request
   (everything except `/health`, `/auth/login`, `/auth/bootstrap`,
   `/auth/setup-status`) ran a `SELECT` + `SELECT` + `UPDATE` through that
   one connection to slide a 14-day TTL forward on every read. Under
   concurrent load this serialized **all authenticated traffic**, not just
   `/runbooks` — any endpoint requiring a session paid it. Fixed by only
   re-sliding when the session hasn't been touched in 5 minutes
   (`sessionSlideInterval`) — indistinguishable for session lifetime,
   removes ~99% of the writes under sustained polling.
2. **Secondary — N+1 in `orchestrator.ListRunbooks`**
   (`backend/internal/orchestrator/store.go`): a per-row `GetRunbook` +
   `SharedAccess` call instead of a batch query. Real bug (O(N) round trips
   instead of O(1)), fixed the same way, but not the driver of the number
   above since the test table was empty — it matters once a deployment has
   many runbooks and viewers with grants.

Measured effect of fix #1 (the one that actually moved the number), same
`api-read.js` scenario, same container image rebuilt with both fixes:

| | Before | After |
|---|---|---|
| `/runbooks` p95 (part of overall `http_req_duration`) | 3.89s | **34.4ms** |
| Dropped iterations | 50,015 | **304** |
| Throughput (checks/s) | 541/s | **1051/s** |
| `vus_max` needed to sustain the ramp | 800 (exhausted) | 176 |

## Verdict

- **The real ceiling was a session-auth design bug, not SQLite or
  runbooks-specific code.** Any read-heavy authenticated workload was
  paying a write-per-request against a single-connection database. Fixed;
  should be re-verified after any future TTL/session-model change.
- **Writes**: didn't find the SQLite write ceiling even after the fix — 469
  writes/s / 80 concurrent writers ran clean, 0 `SQLITE_BUSY`. Postgres is
  not a near-term need on write volume; revisit if real traffic sustains
  **>500 writes/s** or tail write latency matters more than a few hundred
  ms under burst.
- **`ListRunbooks` N+1**: fixed as a batch query; matters more as the
  number of runbooks + shared grants grows, worth re-testing with a
  seeded, non-empty database at some point (not done here).
- **SSE**: comfortable to at least 200 concurrent held streams, no
  goroutine/memory leak on disconnect. Didn't push past 200 — no sign it
  was near a wall.
- **Static asset serving**: not a concern at any load tested (~1600 req/s,
  p99 21ms).
- Caveat: single-container, single-Docker-Desktop-VM test — no network
  latency, no reverse proxy (Caddy) in the loop, generous CPU (8 vCPU) vs a
  typical small VPS (1-2 vCPU). Treat these as "no problem found at this
  scale," not as literal production capacity numbers for a 1-2 vCPU box.
