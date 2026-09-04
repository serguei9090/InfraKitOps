# loadtest/

[k6](https://k6.io) scripts to find the ceilings that matter for a hosted
InfraKit deployment (`docs/plans/POLISH_PLAN.md` PL6). The one that decides *when you need
Postgres* is `write-contention.js`.

## Run

Needs a **Linux** target — SQLite write performance on Windows/macOS is not
representative. Point it at a real `docker compose up` instance (or the
binary with `--auth on`), not `bun run dev`.

```bash
# once, per shell:
export BASE=https://studio.example.com          # or http://localhost:8080
export TOKEN=<a session or static bearer token>

k6 run loadtest/static.js
k6 run loadtest/api-read.js
k6 run loadtest/sse.js
k6 run loadtest/write-contention.js

# machine-readable output:
k6 run --summary-export=out.json loadtest/api-read.js
```

Getting `TOKEN`:
- **single-user** (`--auth off`): the `TOKEN <hex>` line the backend prints.
- **multi-user** (`--auth on`): `curl -sX POST $BASE/api/v1/auth/login -d
  '{"username":"...","password":"..."}' | jq -r .token`.

While a script runs, sample the backend's own metrics in another shell:

```bash
watch -n2 'curl -s $BASE/api/v1/metrics -H "authorization: Bearer $TOKEN" \
  | grep -E "in_flight|goroutines|mem_alloc"'
```

## Scripts

| Script | What it stresses | Headline output |
|---|---|---|
| `static.js` | SPA shell + hashed `/assets/*` serving | req/s the static path sustains, p99 |
| `api-read.js` | a cheap authed `GET` at rising RPS | p95/p99 vs RPS, where errors start, goroutine/heap drift |
| `sse.js` | N concurrent `/…/stream` connections held open | connection ceiling before latency/errors climb; leak check on disconnect |
| `write-contention.js` | many concurrent `PUT /prompts/{id}` (single SQLite writer, 5 s `busy_timeout`) | writes/s before `SQLITE_BUSY` / 5xx — **the Postgres trigger** |

## After a run

Fill `RESULTS.md` with the four numbers + a one-line "Postgres needed when
write RPS > X or concurrent users > Y". That closes the last unknown from the
2026-09-03 production review.
