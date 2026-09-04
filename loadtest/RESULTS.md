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
| `api-read.js` | docker (Linux VM, 8 vCPU) | 2026-09-04 | `/health` fine at any load: p99 **6ms**. `/runbooks` GET is the slow path: p95 **3.9s** once arrival rate outpaces it → **50,015 dropped iterations** (VU pool exhausted waiting on it) at the 1000 req/s target stage. 0% *HTTP* errors throughout — it's a latency ceiling, not a crash |
| `sse.js` | docker (Linux VM, 8 vCPU) | 2026-09-04 | held **200 concurrent** streams with 0% errors, p95 **581ms**. Post-run: goroutines back to **16** (idle baseline), in-flight back to **1** — no leak on disconnect |
| `write-contention.js` | docker (Linux VM, 8 vCPU) | 2026-09-04 | **0** rejected / **0** `SQLITE_BUSY` / **0** 5xx up to **80 concurrent writers**, sustained **469 writes/s**, p95 **216ms** (one outlier at 4.75s, resolved inside the 5s `busy_timeout`, never surfaced as an error). Ceiling not found — 80 VUs was the top of the ramp, not the breaking point |

## Verdict

- **Writes**: didn't find the SQLite ceiling — 469 writes/s / 80 concurrent
  writers ran clean. The `busy_timeout` queues contention instead of
  rejecting it, at the cost of tail latency (one 4.75s write). Postgres is
  not a near-term need on write volume; revisit if a deployment's real
  traffic sustains **>500 writes/s** or tail write latency (p95) matters
  more than a few hundred ms under burst.
- **The real finding is `/runbooks` GET, not SQLite**: it degrades hard
  under concurrent load (p95 3.9s vs `/health`'s p95 1.5ms) well before any
  writer ceiling. That's a specific endpoint to profile (likely doing
  per-row work — history/status joins — that doesn't scale with
  concurrency), not a "move to Postgres" signal. Worth a follow-up: add
  `EXPLAIN QUERY PLAN` / a request-scoped timer around `ListRunbooks` and
  check for N+1 queries before assuming schema is the bottleneck.
- **SSE**: comfortable to at least 200 concurrent held streams, no
  goroutine/memory leak on disconnect. Didn't push past 200 — no sign it
  was near a wall.
- **Static asset serving**: not a concern at any load tested (~1600 req/s,
  p99 21ms).
- Caveat: single-container, single-Docker-Desktop-VM test — no network
  latency, no reverse proxy (Caddy) in the loop, generous CPU (8 vCPU) vs a
  typical small VPS (1-2 vCPU). Treat these as "no problem found at this
  scale," not as literal production capacity numbers for a 1-2 vCPU box.
