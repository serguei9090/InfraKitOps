# InfraKit Studio — self-hosted web bundle

One folder, one process. `infrakit-backend` serves the app UI **and** the
API on a single port — it's the same binary the desktop app runs as a
sidecar, started here with `--static-dir` so it also serves the frontend.

```
infrakit-backend(.exe)   the server
web/                     the built UI
run.sh / run.bat         launcher
data/                    created on first run — sqlite DBs + vault (BACK THIS UP)
```

## Run it

**This machine only (default):**

```
./run.sh            # Linux
run.bat             # Windows
```

Open `http://127.0.0.1:8080`. The first start prints
`SETUP-TOKEN <token>` — paste it in the browser to create the admin account.

**On the LAN / a server** — you must add TLS (passwords are refused in the
clear on a non-loopback address):

```
INFRAKIT_ADDR=0.0.0.0:8080 ./run.sh --tls auto
```

`--tls auto` self-signs and prints `FINGERPRINT sha256:…`. Paste that into
**Settings → Backend** in the app to pin it (browsers warn until you do).
For a real certificate use `--tls /path/fullchain.pem --tls-key /path/privkey.pem`,
or terminate TLS at a reverse proxy and start with `--behind-proxy` instead.

## Environment / flags

| Variable | Flag | Default |
|---|---|---|
| `INFRAKIT_ADDR` | `--addr` | `127.0.0.1:8080` |
| `INFRAKIT_DATA_DIR` | `--data-dir` | `./data` |
| `INFRAKIT_VAULT_PASSPHRASE_FILE` | `--vault-passphrase-file` | — (unlock the shared vault at boot) |
| — | `--auth off` | multi-user is on by default; `off` = one static token, loopback only |

Full reference: `DEPLOY.md` in the source repo.

## The vault

Runbook secrets, LLM API keys and SSH keys live in an encrypted vault.
Under multi-user mode each user unlocks their own from the app after logging
in. For unattended operation put a passphrase in a file and pass
`--vault-passphrase-file` (see `DEPLOY.md`).

## Upgrade

Stop the process, replace `infrakit-backend` + `web/` with the new release,
start again. `data/` carries over; DB migrations run on start. Roll back by
restoring the previous binary — note the database is forward-only.

## Backup

Stop the process and copy the whole `data/` folder.

## Prefer Docker?

The source repo ships a `Dockerfile` + `deploy/compose.yml` (with Caddy for
automatic HTTPS). `cd deploy && docker compose up -d --build`.
