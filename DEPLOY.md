# Deploying InfraKit Studio as a web service

InfraKit Studio ships as a desktop app (see the GitHub Releases) **and** as a
container you can host for a team. This doc covers the hosted path. Rationale
and phase history: [`DEPLOY_PLAN.md`](DEPLOY_PLAN.md).

> **One replica only.** The datastore is SQLite (single writer). This is fine
> for a team or personal deployment. Horizontal scaling would need a Postgres
> port, which is not built.

---

## Quick start (Docker Compose + Caddy)

Prereqs: Docker + Docker Compose, a DNS name pointing at the host (or use
`localhost` for a trial).

```bash
git clone <this repo> && cd infrakit-studio/deploy
cp .env.example .env
$EDITOR .env                                   # set DOMAIN

# the vault passphrase — long + random, keep it safe, it is NOT recoverable
printf '%s' "$(openssl rand -base64 24)" > vault_passphrase.txt
chmod 600 vault_passphrase.txt

docker compose up -d --build
docker compose logs infrakit | grep SETUP-TOKEN
```

Open `https://<DOMAIN>/`, paste the setup token, create the first admin.
Done — that account can now add users and enable modules per user.

Upgrades:

```bash
git pull
docker compose up -d --build          # DB migrations run on start
```

---

## How it fits together

```
  Internet ──443──► Caddy ──►  infrakit-backend (one container)
                     TLS       ├─ /api/v1/*   the API
                               └─ /*          the built React frontend
                              /data volume    sqlite DBs + vault.enc
```

- **One container** serves the API and the frontend on port 8080.
- **Caddy** terminates TLS (Let's Encrypt for a real domain) and proxies to
  it. The backend runs with `--behind-proxy`, so it accepts the non-loopback
  bind and trusts `X-Forwarded-*` from Caddy.
- **`/data`** holds `auth.db`, `orchestrator.db`, `llm.db`, `ansible.db`,
  `history.db`, `vault.enc` (+ `vault/<user>.enc`). Back this up.

The 44 client-only utility tools and the local Prompt Library work with **no
backend at all** — if you only want those, host `app/dist/` on any static
host and skip everything below.

---

## Configuration (environment variables)

Every `INFRAKIT_*` var maps to a `--flag`; an explicit flag still wins.

| Variable | Default (in image) | Meaning |
|---|---|---|
| `INFRAKIT_ADDR` | `0.0.0.0:8080` | bind address |
| `INFRAKIT_AUTH` | `on` | `on` = multi-user sessions; `off` = single static bearer token |
| `INFRAKIT_BEHIND_PROXY` | `1` | a trusted proxy terminates TLS in front; relaxes the non-loopback gate, trusts `X-Forwarded-*` |
| `INFRAKIT_STATIC_DIR` | `/app/web` | directory of the built frontend (`""` = API only) |
| `INFRAKIT_DATA_DIR` | `/data` | parent dir for all DBs + `vault.enc` |
| `INFRAKIT_VAULT_PASSPHRASE_FILE` | — | file whose contents init/unlock the shared vault at boot |
| `INFRAKIT_TLS` | `off` | `auto` (self-signed) or a cert path — use instead of a proxy |
| `INFRAKIT_TLS_KEY` | — | key path, with `INFRAKIT_TLS=<certfile>` |
| `INFRAKIT_CORS_ORIGIN` | — | comma-separated extra browser origins (only if the frontend is on another origin) |
| `INFRAKIT_MAX_CONCURRENT_RUNS` | `4` | cap on runbooks running at once |
| `INFRAKIT_VAULT_AUTOLOCK` | `15m` | idle time before the vault re-locks (`0` = never) |
| `INFRAKIT_LOG_FORMAT` | `text` | `json` for log aggregation (Loki/ELK/Datadog); the compose file sets this |
| `INFRAKIT_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `INFRAKIT_ERROR_WEBHOOK` | — | POST a JSON blob here on a panic / internal error (Slack incoming webhook or any collector) |
| `--pprof <addr>` | — | flag only — serve `net/http/pprof` on a **separate loopback** listener for debugging |

### Observability

- **Access log** — one structured line per request (`method`, `path`,
  `status`, `dur_ms`, `ip`, `req_id`, `user`). Set `INFRAKIT_LOG_FORMAT=json`
  and ship stderr to your log stack.
- **Metrics** — `GET /api/v1/metrics` in Prometheus text format
  (`infrakit_http_requests_total`, `..._request_duration_seconds` histogram,
  `infrakit_http_in_flight`, `infrakit_build_info`, goroutines, heap). It sits
  behind the normal auth — a Prometheus scrape job needs
  `authorization: Bearer <token>` (single-user) or a session token
  (multi-user).
- **Crash reporting** — set `INFRAKIT_ERROR_WEBHOOK` to get a POST on every
  panic / 500. Rate-limited to ≤1/s, best-effort.

---

## TLS options

1. **Reverse proxy (recommended)** — Caddy in the compose file, or your own
   nginx/Traefik/cloud LB. Backend stays plain HTTP behind it with
   `--behind-proxy`.
2. **Backend self-signed** — set `INFRAKIT_TLS=auto`, drop the `caddy`
   service, publish `8080`. The backend prints a
   `FINGERPRINT sha256:…` line; paste it into **Settings → Backend** in the
   app to pin it. No CA, so browsers warn until pinned.
3. **Backend + real cert** — mount a cert + key, set `INFRAKIT_TLS=/certs/fullchain.pem`
   and `INFRAKIT_TLS_KEY=/certs/privkey.pem`.

Without TLS *and* without `--behind-proxy`, `--auth on` on a non-loopback
bind **refuses to start** — passwords in clear are not allowed.

---

## The vault

Runbook `{{secret:…}}` values, LLM API keys, SSH keys and ansible-vault
passwords live in an encrypted vault (`vault.enc`), unlocked with a passphrase
that is never stored.

- **Single-user (`INFRAKIT_AUTH=off`)** or the **shared vault** — the
  passphrase file initialises it on first boot and unlocks it on every
  restart. Keep the file readable only by the container.
- **Multi-user (`INFRAKIT_AUTH=on`)** — each user has their **own** vault and
  unlocks it from the app after logging in. An admin can never read another
  user's vault.
  - **Caveat:** a scheduled runbook / ansible job resolves secrets from its
    **owner's** vault. If that user's vault is locked (auto-lock, or a
    restart), the scheduled run fails until they log in and unlock. Set
    `INFRAKIT_VAULT_AUTOLOCK=0` for accounts that own schedules, or have the
    owner keep a session.
- **Rotate the passphrase** from the app (Settings → the vault section) or,
  for the shared vault, via `POST /api/v1/vault/…`. Changing
  `vault_passphrase.txt` alone does **not** re-key an existing vault — it
  will just fail to unlock.

---

## Backup & restore

### Automatic snapshots (recommended)

Run the backend with `--backup-dir` (the compose file sets
`INFRAKIT_BACKUP_DIR=/data/backups`). Every `--backup-interval` (default
`24h`) it writes a **consistent** archive — each `*.db` is copied with
`VACUUM INTO` (a transactionally-clean copy even while writers are active),
plus `vault.enc` and any per-user vaults, plus a `manifest.json`. Old
archives are pruned to `--backup-keep` (default `7`). A final snapshot is
taken on graceful shutdown.

| Env / flag | Default | |
|---|---|---|
| `INFRAKIT_BACKUP_DIR` / `--backup-dir` | — (off) | where archives go |
| `INFRAKIT_BACKUP_INTERVAL` / `--backup-interval` | `24h` | |
| `INFRAKIT_BACKUP_KEEP` / `--backup-keep` | `7` | `0` = keep all |

Mount `/data/backups` to a **separate** volume (or a host path, or sync it
off-box with `rclone`/`restic`) so a lost `/data` volume doesn't take the
backups with it.

Ad-hoc (before an upgrade): `POST /api/v1/admin/backup` (admin token) — takes
a snapshot now and returns its path.

### Restore

```bash
docker compose stop infrakit
docker run --rm -v deploy_data:/data -v "$PWD:/b" busybox \
  sh -c 'cd /data && rm -f *.db vault.enc && tar xzf /b/infrakit-backup-<ts>.tgz'
docker compose start infrakit
```

Migrations are forward-only — restore onto the **same or older** backend
version, never a newer one. WAL/SHM sidecar files are regenerated on start.

### Manual (no `--backup-dir`)

Stop the container, `tar` the `/data` volume, start. A hot `tar` can tear the
WAL — stop first, or use the automatic snapshots above.

---

## Kubernetes

`deploy/k8s/infrakit.yaml` is a **sketch** (Deployment 1×`Recreate`, PVC,
Service, Ingress, Secret). Build + push the image to a registry your cluster
can pull, set the image reference, create the `infrakit-vault` secret, then
`kubectl apply`. Not a supported chart.

---

## What runs, what doesn't, in a container

| Works | Degraded / off |
|---|---|
| AI Hub, MCP, Prompt Library (server-side), Runbooks (shell/SSH/HTTP/Python), vault, history, user management | **Firewall change** (Windows-only), **Ansible** local runtime unless you extend the image with `ansible`, Network tools needing raw sockets / host privileges |

The image carries `git` + `openssh-client` so Runbooks SSH steps and git
sync work. It does not carry `ansible`, `docker`, or `kubectl`.
