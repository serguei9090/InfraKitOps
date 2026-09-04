# Load test results

> **Not run yet.** Fill this in after a run on a Linux target (see
> `README.md`). Until then the ceilings below are unknown and the "single
> replica is fine for a team" claim in `DEPLOY.md` is an assumption.

| Test | Target env | Date | Result |
|---|---|---|---|
| `static.js` | | | max sustained req/s: — · p99: — |
| `api-read.js` | | | knee at — RPS · p99 at knee: — · errors start at — RPS |
| `sse.js` | | | connection ceiling: — · goroutine/mem after 1 min hold: — · leak on disconnect: — |
| `write-contention.js` | | | writes/s before `SQLITE_BUSY`/5xx: — · p95 write latency at that point: — |

## Verdict

- Single SQLite replica is comfortable up to **~___ write RPS** / **~___
  concurrent users**.
- Move to Postgres (a separate, unplanned effort) when: ______.
- SSE connections: the process holds **~___** open streams before latency on
  other endpoints degrades.
