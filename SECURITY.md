# Security

InfraKit Studio holds credentials — SSH keys, sudo passwords, git tokens, LLM
API keys, `ansible-vault` passwords. This document says how they are stored,
what an attacker can and cannot do, and how to report a problem.

The codebase is AI-assisted. The cryptography is composed from Go's standard
library and `golang.org/x/crypto/argon2` — audited primitives, not hand-rolled
— but the composition has **not** had a third-party audit. Read
[`backend/internal/vault/`](backend/internal/vault/) and file an issue if
something looks wrong.

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting**: the repo's **Security** tab →
*Report a vulnerability*. That opens a private advisory only maintainers can
see. Please do not open a public issue for anything exploitable.

Expected response: an acknowledgement within a few days, a fix or a documented
mitigation before any public disclosure. This is a solo-maintained project —
timelines are best-effort, not contractual.

## The Vault

`backend/internal/vault/` — [`vault.go`](backend/internal/vault/vault.go).

| Step | Detail |
|---|---|
| Master password → key | **Argon2id**, `time=3`, `memory=64 MiB`, `parallelism=4`, 32-byte output. Per-vault random 16-byte salt. |
| Password check | A verifier record — `AES-256-GCM(sentinel)` — decrypted on unlock; wrong password fails the GCM tag, never a plaintext compare. |
| Secret encryption | **AES-256-GCM per secret**, fresh 12-byte random nonce each write, stored as `base64(nonce ‖ ciphertext)`. |
| At rest | One file, `vault.enc` (JSON: kdf params, verifier, per-secret ciphertext). Under `%APPDATA%` (desktop) or `--data-dir` (server). |
| The master password | **Never written anywhere.** Not to disk, not to a database, not to a log. |
| The derived key | Lives only in process memory. Zeroed on `Lock`, on the idle auto-lock timer, and on process exit. |
| Auto-lock | Configurable idle timeout (Settings → Runbooks). Default on. |
| Optional keyring | Opt-in: the 32-byte key can be stored in the **Windows Credential Manager** (via `advapi32`, no third-party dep) so the Vault auto-unlocks after a backend restart. macOS/Linux keyring backends are not implemented. Turning this on trades "survives a restart" for "an attacker with your OS session can unlock the Vault." |

### Secrets never leave the box in plaintext

Modules do not store secret values. They store a reference — `{{secret:NAME}}`
— in their own database (`orchestrator.db`, `monitor.db`, `llm.db`,
`ansible.db`). The value is resolved from the Vault **server-side, at execution
time**, and:

- rendered command lines, request bodies and env vars carry the real value
  only in the child process, never in a stored record;
- **stdout, stderr and the run log are scanned and every secret value is
  redacted** before it is persisted or streamed to a browser
  (`internal/orchestrator`, `internal/monitor/notify.go`);
- `GET` responses for secrets return metadata only (name, kind, notes,
  timestamps) — never the value.

## Transport & network exposure

- **Loopback by default.** The backend binds `127.0.0.1`. Binding a
  non-loopback address is **refused at startup** unless you opt into one of:
  - `--tls auto` — self-signed cert generated on first run, with SHA-256
    fingerprint pinning on the client, or
  - `--behind-proxy` / `INFRAKIT_BEHIND_PROXY` — you are terminating TLS in a
    trusted reverse proxy in front (this is what the container image assumes;
    [`deploy/compose.yml`](deploy/compose.yml) puts Caddy there).
- The desktop build's per-launch bearer token rides in a `?token=` query param
  for SSE streams (EventSource cannot set headers). This is loopback-only.
- **SSH executors pin host keys** (trust-on-first-use, then a mismatch is a
  hard failure — `internal/executor/ssh`).
- Executors run a **destructive-pattern scan** on a rendered command before
  executing it and surface a warning.
- The elevated Windows helper (`infrakit-helper`, used for firewall writes)
  **re-derives the `netsh` argv from a strict typed model** rather than
  trusting the argv it is handed, so a compromised caller cannot inject
  arguments.

## Multi-user mode (`--auth on`)

Off by default. With it off there is no auth layer at all and the solo build is
byte-identical to a single-user tool.

With it on:

- session tokens (opaque, 14-day sliding TTL), passwords hashed with Argon2id
  in `auth.db`;
- per-user data isolation for AI connections, Vault, runbooks, history, the
  server-side Prompt Library;
- an append-only admin audit log;
- a hard gate: `--auth on` still refuses a non-loopback bind without TLS or
  `--behind-proxy`.

**Scope:** this is for a small, trusted team on your own network. It is *not*
hardened for hostile multi-tenancy on the public internet — there is no
account lockout, no 2FA, no per-IP auth rate-limiting beyond an internal
session-refresh throttle, and admins are trusted operators (they can reassign
item ownership, though they cannot browse other users' private items).

## Data locality & telemetry

**There is no telemetry.** No analytics, no crash reporting, no phone-home, no
update check. Grep the source.

All state is local: `%APPDATA%\InfraKitStudio\` (desktop) or `--data-dir`
(server) for databases and `vault.enc`; `localStorage` / IndexedDB for
browser-side preferences.

The only outbound network traffic the app itself makes is to endpoints **you
configure**: LLM providers you add in AI Hub, MCP servers you add, git remotes
you clone, and the hosts your network tools and monitors probe. An optional
error webhook (`--error-webhook`) posts to a URL you set, on 500s/panics only.

## Threat model — what this does and does not protect against

**Protected:**

- `vault.enc` stolen off disk → useless without the master password (Argon2id
  + AES-256-GCM).
- A database file stolen off disk → contains `{{secret:NAME}}` refs, not
  secret values.
- A runbook/monitor logging a secret to stdout → redacted before storage.
- MITM on a `--tls auto` deployment → fingerprint pinning catches a swapped
  cert.
- A malicious command arg passed to the elevated firewall helper → argv is
  re-derived, not trusted.

**Not protected (by design or not yet):**

- An attacker with **code execution as the backend user while the Vault is
  unlocked** — they can read decrypted secrets from process memory. The
  auto-lock timer shrinks this window; the OS-keyring option widens it.
- A **compromised OS session** on a machine using the keyring auto-unlock.
- **Physical access** to an unlocked, running desktop app.
- A **hostile LLM provider or MCP server you added** — treat them as you would
  any third-party API you send data to.
- **Supply-chain**: dependencies are pinned (`bun.lock`, `go.sum`,
  `Cargo.lock`) and the third-party-binary bundling policy is permissive-only
  and SHA-256-recorded ([`vendor-tools/TOOLS.md`](vendor-tools/TOOLS.md)), but
  there is no SBOM signing or build attestation yet.
- **Unsigned installers** — the desktop builds are not code-signed, so the OS
  cannot verify the publisher. Verify the download against the release
  checksums.

## Hardening a self-hosted deployment

1. Put it behind a reverse proxy that terminates TLS (`deploy/compose.yml`
   does this with Caddy). Do not expose `:8080` directly.
2. Use `--vault-passphrase-file` pointing at a mounted secret for headless
   Vault unlock rather than the OS keyring.
3. Keep `--auth on` (the image default) and create real per-user accounts.
4. Restrict who can reach the instance at the network layer — it is a team
   tool, not a public one.
5. Take the built-in backups (`--backup-dir`, on by default in the image) off
   the box.
