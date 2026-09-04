# OBSERVABILITY_PLAN.md — logging, error handling, metrics

Close the production-readiness gaps found in the 2026-09-03 review: no
structured logging, no access log, no React error boundary, no metrics, no
error aggregation. Bumps the app from "solid internal tool" to "run it for a
real team".

**No new dependencies.** `log/slog` is stdlib; `chi/middleware` already
vendored; metrics are hand-rolled Prometheus text.

## Phases

> **ALL SHIPPED 2026-09-03.** O0/O2/O4 — backend `internal/obs` (slog setup +
> printf bridges + `Recoverer` + `AccessLog` + hand-rolled `/metrics` + error
> webhook), all 44 `log.*` migrated, `--log-format/--log-level/--error-webhook/--pprof`
> flags + `INFRAKIT_*`, `backend.yml` grep guard, DEPLOY.md + Dockerfile +
> compose. O1 — `<ErrorBoundary>` (App + per-route in the shell) +
> `window.addEventListener('error')`. O3-frontend — `errorWebhook.ts`
> (`VITE_ERROR_WEBHOOK`, ≤1/s) fed from `errorStore.report`.

### O0 — backend: structured logging + access log + slog recoverer

- **`internal/obs`** (new):
  - `Setup(w io.Writer, format, level string) *slog.Logger` — `text`
    (default, human) or `json`; levels `debug|info|warn|error`. Calls
    `slog.SetDefault`.
  - `Fatal(msg string, args ...any)` — `slog.Error` + `os.Exit(1)` (replaces
    `log.Fatalf`).
  - `Recoverer(next http.Handler) http.Handler` — catches panics, logs
    `slog.Error` with request id + stack, writes a 500 via `apierr`.
  - `AccessLog(trustProxy bool) func(http.Handler) http.Handler` — one line
    per request: `method`, `path`, `status`, `bytes`, `dur_ms`, `ip` (real
    client — `X-Forwarded-For` only when `trustProxy`), `req_id`, `user`
    (from `userctx` after auth). SSE streams log on start + on close.
- **Flags** (+ `INFRAKIT_*`): `--log-format text|json`, `--log-level`.
- **`server.NewRouter`**: `middleware.RequestID` → `obs.Recoverer` →
  `obs.AccessLog(trustProxy)` → the existing middleware. Drop
  `middleware.Recoverer`.
- **Migrate** the 44 `log.Printf` / `log.Fatalf` (42 in `main.go`, 2 each in
  `vault/registry.go`, `orchestrator/scheduler.go`, `ansible/scheduler.go`)
  → `slog.Info/Warn` / `obs.Fatal`. `backend.yml` grep guard: no `log.Print`
  / `log.Fatal` outside `internal/obs`.
- **Health**: `/health` already returns `version`; add `startedAt` unix.

### O1 — frontend: error boundary + sync-error handler

- **`adapters/ui/errors/ErrorBoundary.tsx`** — class component,
  `getDerivedStateFromError` + `componentDidCatch` → `reportError(err,
  'render')`. Fallback: a centered "Something broke" card with **Reload** and
  (dev only) the message + component stack. `resetKeys` prop so a route
  change clears it.
- **`App.tsx`**: wrap `<RouterProvider>`. **`routes.tsx`**: a shared
  `errorElement` on the layout route so a lazy-route throw shows the fallback
  in-shell, not white-screen.
- **`installErrorHandlers`**: add `window.addEventListener('error', …)` —
  report script errors, ignore resource (`<img>`/`<script>` load) errors and
  ResizeObserver noise.

### O2 — dependency-free `/metrics` (Prometheus text)

- **`internal/obs/metrics.go`** — `sync/atomic` counters + a fixed-bucket
  duration histogram + an in-flight gauge, rendered in Prometheus exposition
  format. Series: `infrakit_http_requests_total{method,code}`,
  `infrakit_http_request_duration_seconds` (histogram),
  `infrakit_http_in_flight`, `infrakit_build_info{version}`,
  process/Go basics from `runtime`.
- `AccessLog` middleware also feeds the metrics.
- **`GET /api/v1/metrics`** — behind the normal auth (Prometheus scrape uses
  `authorization` / `bearer_token`). Documented in `DEPLOY.md`.

### O3 — error webhook (dep-free crash reporting)

- **Backend**: `--error-webhook <url>` / `INFRAKIT_ERROR_WEBHOOK`. The slog
  recoverer + any `apierr.Internal` write POSTs
  `{ts, level:"error", msg, req_id, path, method, err, version}` —
  fire-and-forget, 3 s timeout, dropped on failure, rate-limited (≤1/s).
- **Frontend**: `errorStore` — if a runtime setting or `VITE_ERROR_WEBHOOK`
  is set, POST the classified `AppErr` (title, code, source, message, url,
  ua). Rate-limited, no PII beyond the message.
- Point it at Slack (incoming webhook shape) or any collector. Off by
  default.

### O4 — pprof (debug, opt-in, loopback)

- **`--pprof <addr>`** (default `""` = off). When set, a **separate**
  `http.Server` on that addr with `net/http/pprof` mounted. Never on the main
  mux; operator binds `127.0.0.1:6060`. `slog.Warn` on start so it's obvious.

## Order + effort

O0 (~half day, mostly the mechanical migration) → O1 (~2 h) → O2 (~3 h) →
O4 (~30 min) → O3 (~2 h). Each phase a green commit.

## Non-goals

- OpenTelemetry / distributed tracing (single service).
- Log shipping config (that's the operator's Loki/Vector/Fluentbit).
- A bundled Grafana dashboard (provide the metric names, not the dashboard).
- APM / continuous profiling.
