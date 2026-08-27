# infrakit-backend

Network-tools backend for InfraKit Studio. One binary, two deployment modes:

- **desktop** — a Tauri v2 sidecar spawned and supervised by `app/src-tauri`
- **web** — a standalone HTTP service (or absent, in which case the network
  tools show a "backend unavailable" state and the other 44 tools are unaffected)

Full design: [`../NETWORK_MODULE_PLAN.md`](../NETWORK_MODULE_PLAN.md).

## Run

```bash
cd backend
go run ./cmd/infrakit-backend --addr 127.0.0.1:8765 --token dev
# or let it pick a port and print a token:
go run ./cmd/infrakit-backend
```

First stdout line is `LISTENING <host:port>`. If `--token` is omitted a random
one is generated and printed as `TOKEN <token>` (dev only — the sidecar is
always launched with an explicit token).

## Startup flags

| flag | default | meaning |
|------|---------|---------|
| `--addr` | `127.0.0.1:0` | bind address; `:0` = ephemeral port |
| `--token` | *(generated)* | bearer token required on every request |
| `--idle-timeout` | `0` (off) | exit after this long with no request |
| `--parent-pid` | `0` (off) | exit when this process id disappears |
| `--db` | *(OS config dir)* | history DB path; `off` disables history |
| `--history-retention-days` | `90` | default history retention |
| `--history-max-per-target` | `20` | default runs kept per (tool, target) |
| `--version` | | print version and exit |

## API

All routes are under `/api/v1` and require `Authorization: Bearer <token>`
(EventSource streams accept `?token=<token>` instead, since they cannot set
headers). CORS is locked to the Tauri and Vite-dev origins.

| method | path | purpose |
|--------|------|---------|
| GET | `/health` | liveness + `{ os, elevated, version, pid, uptimeSec }` |
| GET | `/capabilities` | per-tool `{ available, reason?, needsElevation? }` map |
| GET | `/interfaces` | host network interfaces (name, MTU, addrs, flags) for the source-interface picker |
| POST | `/iperf3` | throughput test (needs iperf3 — bundled on Linux/macOS, `winget install ar51an.iPerf3` on Windows) |
| GET/POST | `/iperf3/server` | status / start-stop a managed local `iperf3 -s` |
| GET | `/history` | run summaries — `?tool=&target=&limit=` |
| POST | `/history` | store a `RunEnvelope`; `?retentionDays=&maxPerTarget=` override the prune defaults |
| GET | `/history/{id}` | one full stored run |
| PATCH | `/history/{id}` | `{ pinned?, label? }` — pinned/labelled runs are never pruned |
| DELETE | `/history/{id}` | remove one run |

Tool endpoints are added per phase (N1+). Streaming endpoints use SSE. History is
embedded SQLite (pure-Go `modernc.org/sqlite`); a store that fails to open makes the
`/history` routes return 503 while every other tool keeps working.

## Layout

```
cmd/infrakit-backend/   main: flags, listener, stdout contract, signals, history DB
cmd/infrakit-helper/    one-shot elevated helper (hosts-file write), spawned via UAC/pkexec
internal/server/        router wiring, middleware (auth/CORS/activity), idle watchdog
internal/sse/           channel-funnelled SSE writer for the streaming tools
internal/api/           one file per endpoint concern
internal/envelope/      the RunEnvelope shape stored by the history layer
internal/history/       embedded-SQLite run store + prune policy
internal/privilege/     "is this process elevated?" (per-OS)
internal/elevate/       spawn infrakit-helper with a UAC / polkit prompt
internal/cmdtool/       exec + JSON-unmarshal helper for tools that shell out (not a framework)
internal/tools/         one package per network tool (ping, traceroute, dnslookup, …)
```

## Bundled binaries

`../vendor-tools/` pins third-party binaries (see `TOOLS.md`, license gate in
`../CLAUDE.md`). `vendor-tools/fetch-tools.sh` downloads + SHA-256-verifies them;
`build-sidecar` copies the arch-matched one next to the backend. Today: **iperf3**
(BSD-3, static, Linux + macOS — not Windows: every Windows build links GPL
`cygwin1.dll`).

## Test

```bash
go test ./...
```
