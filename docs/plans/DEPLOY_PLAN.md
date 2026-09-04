# DEPLOY_PLAN.md — hosted web deployment (Docker + CI)

Plan for running InfraKit Studio as a **hosted web service** instead of (or
alongside) the desktop app.

> **Status: D0–D5 all shipped (2026-09-03).** `docker compose up -d --build`
> in `deploy/` gives a working hosted instance. See [`DEPLOY.md`](../deployment/DEPLOY.md)
> for operating it. Each phase below carries a ✅ with what landed.

### Decisions locked (2026-09-03)

| # | Decision |
|---|---|
| Base image | **`debian:stable-slim`** — git + openssh-client + ca-certificates present |
| Auth default | **`INFRAKIT_AUTH=on`** baked in; first-run `SETUP-TOKEN` flow |
| Registry | **None — local build only.** No GHCR / Docker Hub push. CI just *builds* the image as a gate; `compose.yml` builds from the local context. Publishing can be added later by turning the D3 push back on. |
| Settings sync (D5) | **In scope** for this effort. |

Related: [`USER_MANAGEMENT_PLAN.md`](USER_MANAGEMENT_PLAN.md) (the `--auth on`
layer, done U0–U6), [`packaging-plan`](PACKAGING_PLAN.md) /
`ROADMAP.md` P7 (desktop installers, this is the web sibling),
`SETTINGS_MODULE_PLAN.md` §S3e (settings sync — rides on D5).

---

## 1. What already exists (no work needed)

| Piece | State |
|---|---|
| Multi-user auth | `--auth on` — sessions, per-user data, admin, audit log, `SETUP-TOKEN` bootstrap (U0–U6) |
| TLS | `--tls auto` (self-signed + printed `FINGERPRINT`) or `--tls <cert> --tls-key <key>` (U6) |
| Non-loopback safety gate | `--auth on` + non-loopback bind + no TLS → **fatal** (main.go:249) |
| CORS allowlist | `--cors-origin <origin>` (repeatable) |
| Remote-endpoint frontend | web build reads `VITE_BACKEND_URL` (+ `VITE_BACKEND_TOKEN`) at build time, or a runtime `localStorage` override (S3f, `endpointOverride.ts`) |
| Static binary | `modernc.org/sqlite` (pure Go) + `CGO_ENABLED=0` → single static ELF, no libc; distroless/scratch works |
| DB path flags | `--db`, `--runbook-db`, `--llm-db`, `--ansible-db`, `--vault`, `--auth-db` all take explicit paths |
| Web bundle in CI | `release.yml` already attaches `infrakit-studio-web-<v>.zip` |
| Health endpoint | `GET /api/v1/health` — **no auth**, returns `{status,version,authMode,tls,fingerprint}` |

**The 44 client-only tools + the local Prompt Library work with no backend at
all** — a plain static-file deploy of `app/dist/` is already a valid product.
The backend is only needed for Network / Runbooks / AI Hub / Ansible / vault /
server-side Prompt Library.

## 2. What's missing

1. **Backend doesn't serve the frontend.** The router only mounts `/api/v1/*`
   and every route sits behind the auth middleware. Need a public static
   handler (SPA fallback) that is *not* behind auth, with `/api/*` passed
   through.
2. **Vault re-locks on every restart in a headless container.** The OS keyring
   backing is Windows-only (`keyring_other.go` → unsupported). On Linux the
   vault must be unlocked through the UI after each backend start — so
   scheduled runbook/ansible runs and any `{{secret:}}` resolution break until
   a human logs in and unlocks.
3. **Reverse-proxy TLS trips the safety gate.** If a proxy terminates TLS and
   forwards plain HTTP to the backend on `0.0.0.0`, `--auth on` refuses to
   start (sees non-loopback + no TLS). Works only if the backend binds
   loopback and the proxy is same-host — or a flag says "TLS is upstream".
4. **No container image, no compose file, no image CI, no deploy docs.**
5. **Config is flags-only.** Containers want env vars.

## 3. Target topology (recommended)

```
              :443 TLS                 127.0.0.1:8080 (plain, loopback)
   Internet ───────────►  Caddy/Traefik ──────────►  infrakit-backend
                          (or platform ingress)      --auth on
                                                     --static-dir /app/web
                                                     --data-dir /data
                                                     serves  /        (SPA)
                                                             /api/v1  (API)
                          /data  ──►  named volume (sqlite DBs + vault.enc)
```

- **One container** = backend binary + `dist/` copied in, served on one port.
- TLS terminates at a proxy (Caddy in the compose file; ingress on k8s).
  Backend binds `127.0.0.1` → the loopback gate is satisfied with **zero
  backend change**. `--behind-proxy` (D1) covers the split-host case.
- **Single replica.** sqlite is single-writer. Fine for a team/personal
  deployment. Horizontal scale needs a Postgres port — explicitly **out of
  scope**, a separate future effort.

## 4. Phases

Commit per phase (each builds + tests green on its own).

### D0 — backend: static serving + data-dir + env config ✅ DONE

*Backend only. No Docker yet. Independently shippable — improves any
non-desktop run.*

Landed: `internal/server/static.go` (`StaticHandler` — `/api/*` passthrough,
asset immutable-cache, SPA fallback, dotfile block), `--static-dir` +
`--data-dir` flags, `applyEnv` (`INFRAKIT_*` fallback for
`addr/auth/data-dir/static-dir/tls/tls-key` + `INFRAKIT_CORS_ORIGIN`
comma-split), `dataDirOverride` threaded through `appDataDir()` (+ `openHistory`
refactored onto it), same-origin allowance in `cors()`. 8 tests. Smoke: built
binary with `--auth on` serves `/api/v1/health`, SPA routes, and immutable
assets.

- **`server.StaticHandler(dir string, api http.Handler) http.Handler`**
  (new, `internal/server/static.go`):
  - `/api/*` → delegate to `api` (the current `NewRouter` output) unchanged.
  - everything else → serve from `dir`; a path that doesn't resolve to a file
    and has no extension → serve `index.html` (SPA history fallback).
  - `Cache-Control: public,max-age=31536000,immutable` for `/assets/*`
    (Vite hashes them); `no-cache` for `index.html`.
  - never serve dotfiles; `http.FS` + `fs.Sub`, no `..` traversal.
  - **not** wrapped by `sessionAuth`/`bearerAuth` — the shell + JS load
    before the user has a token; the app authenticates against `/api/v1`.
- **`--static-dir`** (default `""` = don't serve, current behaviour). When
  set, main.go wraps the API handler with `StaticHandler`.
- **`--data-dir`** (default `""`): when set, the six DB paths default to
  `<data-dir>/{history,orchestrator,llm,ansible,auth}.db` + `<data-dir>/vault.enc`
  unless individually overridden. Replaces setting `$XDG_CONFIG_HOME`.
- **env fallback** (`internal/server/envflag.go` or inline): after
  `flag.Parse()`, for the deploy-relevant flags fall back to
  `INFRAKIT_<NAME>` when the flag is at its default. Covered:
  `ADDR, AUTH, DATA_DIR, STATIC_DIR, TLS, TLS_KEY, CORS_ORIGIN (comma-split),
  VAULT_PASSPHRASE_FILE, BEHIND_PROXY, MAX_CONCURRENT_RUNS,
  VAULT_AUTOLOCK`. Flags still win when explicitly passed.
- Tests: `static_test.go` — asset cache header, SPA fallback, `/api`
  passthrough, dotfile 404, traversal blocked; `envflag_test.go`.
- Docs: flag help text; a line in `CLAUDE.md` backend section.

**Est. 0.5–1 d.**

### D1 — backend: headless vault unlock + proxy gate ✅ DONE

Landed: `--vault-passphrase-file` (+ `INFRAKIT_VAULT_PASSPHRASE_FILE`) —
`unlockVaultFromFile` reads the file, `Init` a fresh shared vault or `Unlock`
an existing one at boot (fatal on misconfig; no-op + log if keyring already
unlocked it). `--behind-proxy` (+ `INFRAKIT_BEHIND_PROXY` truthy) downgrades
the non-loopback+auth+no-TLS **fatal to a warning** and calls
`server.SetTrustProxy(true)` (X-Forwarded-Host believed for same-origin CORS).
`flagPassed` / `envTruthy` helpers. 4 tests. Smoke: `0.0.0.0` bind + `--auth
on` + `--behind-proxy` starts with a warning; passphrase file initialises +
unlocks the vault.

Original notes below.


- **`--vault-passphrase-file <path>`** (+ `INFRAKIT_VAULT_PASSPHRASE_FILE`):
  at boot, read the file (trim trailing newline); for the **single-user**
  vault: `Init(pw)` if uninitialised, else `Unlock(pw)`. Log
  `vault: auto-unlocked from passphrase file`. Never log the value.
  - Multi-user (`--auth on`): there is one vault **per user**, so a single
    file can't unlock them all. Behaviour: unlock only the legacy/shared
    vault if present; **document** that each user unlocks their own vault
    after login, and that scheduled runs need the runbook/job owner's vault
    unlocked (pre-existing limitation, now written down). A future
    "service vault" for automation is out of scope here.
- **`--behind-proxy`** (+ `INFRAKIT_BEHIND_PROXY=1`): relaxes the
  non-loopback + `--auth on` + no-TLS fatal to a **loud warning** ("TLS
  assumed terminated upstream; do not expose this port directly"). Also
  makes the middleware trust `X-Forwarded-Proto`/`-For` from the immediate
  peer for logging + secure-cookie decisions. Without the flag the gate is
  unchanged.
- Tests: passphrase-file init vs unlock vs wrong-password; gate with/without
  `--behind-proxy`.

**Est. 0.5 d.**

### D2 — Dockerfile + compose ✅ DONE

Landed: root `Dockerfile` (3-stage: `oven/bun` build frontend → `golang:1.25`
`CGO_ENABLED=0` build backend → `debian:stable-slim` w/ ca-certs+git+ssh+curl,
non-root uid 10001, `/data` volume, `HEALTHCHECK`, hosted `INFRAKIT_*` env
defaults, `ENTRYPOINT infrakit-backend`). `.dockerignore`. `deploy/compose.yml`
(infrakit `build:` local + `init:true` + healthcheck + Docker secret for the
vault passphrase; `caddy` for TLS), `deploy/Caddyfile` (Let's Encrypt / internal
CA, `X-Forwarded-*`, `flush_interval -1` for SSE), `deploy/.env.example`,
`deploy/k8s/infrakit.yaml` sketch. **Verified: `docker build` → 222 MB image;
`docker run` serves `/api/v1/health` (`os:linux`, `authMode:on`,
`version:deploy-test`), SPA routes 200, DBs under `/data`, `--behind-proxy`
warning not fatal, `SETUP-TOKEN` printed.** `docker compose config` valid.
Known: buildkit warns `SecretsUsedInArgOrEnv` on `ENV INFRAKIT_AUTH` (name
matches "AUTH"; not actually a secret — false positive).

### D2 — original notes

- **`Dockerfile`** (repo root), multi-stage:
  1. `oven/bun` → `bun install --frozen-lockfile && bun run build` in `app/`
     (accepts `--build-arg VITE_BACKEND_URL=` — default empty = same-origin).
  2. `golang:1.25` → `CGO_ENABLED=0 go build -trimpath -ldflags "-s -w"` the
     backend (+ `infrakit-helper`), `TARGETARCH`-aware for buildx.
  3. final: **`debian:stable-slim`** (not distroless) — carries `git`,
     `openssh-client`, `ca-certificates` so the Runbooks SSH/git executors
     and Ansible git-projects work. `ansible` / `docker` CLIs are **not**
     bundled (large / privileged); those Ansible runtimes then report
     unavailable, same as today on a machine without them. Non-root
     `USER app`, `WORKDIR /app`, `/data` volume, `EXPOSE 8080`,
     `HEALTHCHECK` → `/api/v1/health`.
     Entry: `infrakit-backend --addr 0.0.0.0:8080 --static-dir /app/web --data-dir /data`.
  - a `distroless` build target as a comment/alt for the minimal-attack-surface
    crowd (accepts: no ssh/git/ansible).
- **`.dockerignore`** — `node_modules`, `app/dist`, `target/`, `*.db`, `.git`.
- **`deploy/compose.yml`**:
  - `infrakit` service — **`build: { context: .. }`** (local build, no
    registry), `--auth on --behind-proxy`, env from `deploy/.env`, `/data`
    → named volume.
  - `caddy` service — 20-line `Caddyfile`, TLS via Let's Encrypt (`DOMAIN`
    env), `reverse_proxy infrakit:8080`, gzip/zstd.
  - `deploy/.env.example` — every `INFRAKIT_*` var with comments.
- **`deploy/k8s/`** (sketch, not a full chart): `Deployment` (1 replica,
  `strategy: Recreate`), `PVC`, `Service`, `Ingress` (TLS at ingress),
  `Secret` for `INFRAKIT_VAULT_PASSPHRASE_FILE` mounted as a file.

**Est. 0.5–1 d.**

### D3 — image build gate (`.github/workflows/image.yml`) ✅ DONE

Landed: `.github/workflows/image.yml` — buildx `push:false load:true`
`linux/amd64`, GHA cache, then `docker run` + poll `/api/v1/health` for
`"authMode":"on"`, dump logs, clean up. Triggers on `Dockerfile` / `deploy/**`
/ `app/**` / `backend/**` changes + manual. Publishing = a commented note in
the file (flip `push:true` + add login + tags). The docker steps mirror the
D2 manual smoke that passed locally.

*No registry — build-only, to catch a broken Dockerfile before it reaches
someone's `docker compose up`.*

- Trigger: `push`/`pull_request` touching `Dockerfile`, `deploy/**`, `app/**`,
  `backend/**`.
- `docker/setup-buildx-action` + `docker/build-push-action` with
  **`push: false`**, `load: true`, single platform `linux/amd64`, GHA cache.
- Smoke test: `docker run` the built image with `--auth on` + a temp volume,
  `curl -fsS localhost:8080/api/v1/health`, assert `200` + `authMode:"on"`,
  then stop.
- `VITE_BACKEND_URL` build-arg empty (same-origin default).
- **Publishing later**: flip `push: true` + add registry login + tags
  (`:<version>` from `set-version`, `:edge` on main). One block, commented in
  the workflow so it's a small diff when wanted.
- `backend.yml` / `frontend.yml` untouched (still the source-of-truth gates).

**Est. 0.5 d.**

### D4 — `DEPLOY.md` ✅ DONE

Landed: `DEPLOY.md` at repo root — quick start (compose + Caddy + first-admin),
architecture diagram, full `INFRAKIT_*` env table, 3 TLS options, vault ops
(shared passphrase file vs per-user unlock + the scheduled-run caveat),
backup/restore (stop-copy-start; hot-copy tear warning), k8s pointer,
works/degraded matrix. Linked from `DEPLOY_PLAN.md`.

- **Quick start** — `docker compose up -d` with a domain, 5 steps to first
  admin (`SETUP-TOKEN` from `docker compose logs`).
- **Topologies** — (a) single host + compose + Caddy; (b) behind an existing
  nginx/Traefik; (c) k8s with ingress TLS.
- **Env reference** — table of every `INFRAKIT_*` var.
- **TLS** — proxy termination (recommended) vs `--tls auto` + fingerprint
  pinning in Settings → Backend.
- **Vault ops** — single-user passphrase file; multi-user per-user unlock;
  the scheduled-run caveat; how to rotate.
- **Backup / restore** — stop the container (or `sqlite3 .backup`), copy the
  `/data` volume. WAL means a hot copy can tear — document the safe path.
- **Upgrade** — `docker compose pull && up -d`; migrations run on open;
  roll back by pinning the previous tag (DB is forward-only — note it).
- **Scaling** — one replica only (sqlite). Postgres port = not planned.
- **What needs no backend** — you can also just host `app/dist/` on any
  static host / CDN and only the backend-backed modules go dark.

**Est. 0.5 d.**

### D5 — settings sync (S3e) ✅ DONE

Landed:
- Backend: `auth_user_settings` table (`user_id` PK, `data` JSON, `updated_at`)
  in `auth.db`; `Store.GetUserSettings` / `PutUserSettings` (merge-patch, JSON
  `null` deletes a key, dropped on user delete); `GET|PUT /api/v1/settings/user`
  on `AuthHandlers` (session-gated, 256 KiB cap, exempt from the read-only
  write-block — personal setting). 2 tests.
- Frontend: `adapters/backend/userSettingsClient.ts`;
  `adapters/storage/syncedSettings.ts` — `syncedStorage()` wraps the
  `IStoragePort` zustand adapter (local write always + 800 ms debounced push
  when enabled), `pullSettings()` fetches the blob on login/boot, writes
  newer keys locally, `.persist.rehydrate()`s the affected stores;
  `stopSync()` on logout. The 4 synced stores (`theme`, `module-prefs`,
  `shortcuts`, `network-settings`) swapped onto `syncedStorage()`; `authStore`
  calls `pullSettings` after `login`/`bootstrap`/`init`-with-session and
  `stopSync` on `logout`. 4 tests. **Endpoint override NOT synced** (it names
  the backend — must stay per-device).
- **Verified E2E** via the real binary: bootstrap → `GET {}` → `PUT` merges →
  `GET` returns merged → `PUT {theme:null}` deletes just that key.

`SETTINGS_MODULE_PLAN.md` §S3e: killed → done.

Original notes below.

- Backend: `user_settings` table (per-user JSON blob), `GET/PUT
  /api/v1/settings/user` (auth-gated).
- Frontend: a `SyncedSettingsStore` that reads/writes the blob when
  `authStore.mode === 'on'`, falls back to `IStoragePort`/`localStorage`
  otherwise. Covers: theme, module order/visibility, keyboard shortcuts,
  network blob, endpoint override.
- Merge rule: server wins on login; local edits debounce-push.
- `SETTINGS_MODULE_PLAN.md` §S3e updated from "killed" to "done".

**Est. 0.5 d.**

---

## 5. Total — DONE

All of D0–D5 shipped in 8 commits (`010cd16` plan, then `35c126a` D0,
`1260c2d` D1, `810ae51` D2, `27fe422` D3, `29d7cac` D4, `43abec0`+`77b6fc8`
D5). **No new Go or frontend dependencies.** Frontend 1336 tests green,
backend all packages green, hex boundary intact. Verified end-to-end against
both the built binary and the built container image (health, SPA routing,
immutable assets, `--behind-proxy` gate, headless vault unlock, settings-sync
round-trip).

## 6. Non-goals

- Multi-replica / HA (needs Postgres — separate effort).
- Managed cloud offering, autoscaling, k8s Helm chart (sketch only).
- Bundling `ansible` / `docker` / `kubectl` into the image.
- Changing the desktop (Tauri) path — it keeps using the loopback sidecar
  with no TLS and no auth, byte-identical.
- Windows/macOS container images.

## 7. Open questions

All resolved — see "Decisions locked" at the top.
