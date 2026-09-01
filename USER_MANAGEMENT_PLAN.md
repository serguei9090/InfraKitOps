# User management module (U)

Status: **U0–U6 COMPLETE 2026-09-01.** Full multi-tenant user management ships:
opt-in `--auth on`, per-user AI data + per-user vaults + per-user runbooks/
history + server-side Prompt Library, multi-user runbook approvals, admin
audit log, self-signed TLS with fingerprint pinning + a hard non-loopback
gate. `--auth off` is byte-identical to before. Commits: `711c812` U0 ·
`458996a` U1 · `7557fbb`+`8a2bad8` U2 · `906bef4` U3 · `41ef0a1` U4 ·
`d6b9aa4` U5 · `505de32` U6. Supersedes
[`USER_MANAGEMENT_PROPOSAL.md`](USER_MANAGEMENT_PROPOSAL.md) — all 10
decisions resolved (§2).

**Remaining polish (not blocking):** the Tauri desktop custom-cert verifier
for a desktop app pointed at a remote HTTPS backend (the loopback sidecar
needs no TLS); per-resource ACLs / sharing; SSO/OIDC/LDAP (explicitly out).

---

## 1. Why

Deploy InfraKit Studio as a **shared web service** (the `S3f` endpoint
override made this real) so a team hits **one backend** — e.g. everyone gets
their own AWS / Linux command runbooks and runs their own bash-over-SSH steps,
with a set of **shared, published** runbooks and prompts on top. Also fixes
the "one shared PC session, everyone's stuff mixed together" pain.

Two classes of data, both needed:

- **Private** — my connections, my API keys, my draft runbooks, my vault, my
  run history, my prefs.
- **Shared** — published runbooks + published prompt templates (the library
  already has a publish gate), instance settings (admin).

---

## 2. Resolved decisions

| # | Decision |
|---|----------|
| 1 Driver | **Multi-tenant shared backend (scenario B).** Per-user data from the start; not shipping a login-only phase as the end state. |
| 2 Default | **`--auth off` by default.** Solo desktop / sidecar unchanged — no login, no users, today's bearer-token path intact. |
| 3 Scope | **Per-user data is in scope from day one.** Build order still does identity + login first (testable milestone), but the module isn't "done" until data scoping lands. |
| 4 Vault | **Per-user vault files** — `vault/<userID>.enc`, each with its own passphrase, RAM key, auto-lock. `internal/vault` becomes a registry. |
| 5 Credentials | **Two secrets: login password ≠ vault passphrase.** Login authenticates; the vault passphrase decrypts secrets. A user may never unlock their vault and still use everything else. |
| 6 Web session | **`localStorage`** — survives tab changes and browser restart (remote users shouldn't re-login constantly). Token is high-entropy + server-revocable, so persistence is acceptable. |
| 7 TLS | **Backend self-signs + client pins the cert fingerprint** — same trust model as the Runbooks SSH host-key pinning. Reverse-proxy TLS stays documented as the production option. |
| 8 Prompt Library | **Moves server-side** in multi-user mode (`owner_id` scoped, publish/gallery kept). Solo mode keeps the current client-only `IStoragePort` repo. |
| 9 Cross-device sync (S3e) | **Roadmap only, "if requested."** Accounts make it possible; not building it. |
| 10 RBAC | **`admin` / `operator` / `viewer`** base roles **+ per-user module access** — admin can restrict a user to a subset of rail modules (`allowedModules`, null = all). |

---

## 3. Architecture

### 3.1 `internal/auth/` (new)

- **`auth.db`** — pure-Go `modernc.org/sqlite`, sibling of `llm.db` /
  `orchestrator.db`. Flag `--auth-db` (default alongside the others).
  - `user` — `id, username UNIQUE, email, password_hash, role, allowed_modules
    (JSON, null=all), disabled, must_change_pw, created_at, updated_at`.
  - `session` — `token_hash UNIQUE, user_id, created_at, expires_at,
    last_seen_at, user_agent`. Token = 32 random bytes base64url; stored as
    SHA-256(token). Sliding expiry (default 14d, renew on use).
  - `audit_log` — `id, at, user_id, action, target, meta_json`. Append-only via
    the API.
- **Passwords:** Argon2id (`golang.org/x/crypto/argon2`, already vendored).
  Params recorded next to the hash like the vault does.
- **`Service`** — `Bootstrap`, `Login(user, pw) → (session, error)` with
  per-username+IP throttle (exponential backoff, lock after 5 fails / 15 min),
  `Validate(token) → *User`, `Logout`, `ChangePassword`, `Users` CRUD,
  `Audit(ctx, action, target, meta)`.
- **`--auth` flag / instance setting:** `off` (default) | `on`. When `on` and
  `user` is empty → first-run: backend prints `SETUP-TOKEN <token>` once; the
  frontend's "create first admin" screen POSTs it to `/auth/bootstrap`. No
  admin password in env vars / process args.

### 3.2 Middleware (`internal/server`)

- `authMode == off` → keep `bearerAuth(opts.Token)` exactly as today.
- `authMode == on` → `sessionAuth`: reads `Authorization: Bearer <session>`,
  `Validate`, bumps `last_seen_at`, injects `*auth.User` into request context.
  `/health` and `/auth/{login,bootstrap}` are exempt.
- `moduleGuard`: maps a route prefix → module id
  (`/runbooks*`→`runbook`, `/llm*`+`/mcp*`→`ai`, network routes→`network`,
  `/vault*`→whichever module owns it, …); 403 if the user's `allowedModules`
  excludes it. Client-only modules (utilities, config builders, Knowledge Hub,
  FormFlow) have **no backend routes** → their gating is UI-only (rail + route
  guard), acceptable since they're offline and dataless.
- CORS: `authMode == on` tightens the reflect-any-origin default to a
  configured allowlist.

### 3.3 Vault registry

`internal/vault` grows a `Registry` — `map[userID]*Vault`, each backed by
`vault/<userID>.enc`, its own passphrase / RAM key / auto-lock timer.

- `SecretResolver` (used by MCP + Runbooks) becomes user-scoped:
  `Resolve(userID, id)` / `ResolveByName(userID, name)`. Thread `userID` from
  the request context through `mcp.Manager`, `orchestrator`, the executors.
- `authMode == off` → a single implicit vault keyed by `""` (today's exact
  behaviour).
- `/vault/*` endpoints act on the **calling user's** vault.

### 3.4 Data scoping

Add `owner_id` (nullable; `NULL` = pre-auth / shared) + filter every read &
write by the context user:

| Subsystem | Owned | Shared | Notes |
|-----------|-------|--------|-------|
| AI | `llm_connection`, `llm_conversation`, `llm_task` (custom rows), `mcp_server`, `llm_usage` | built-in tasks, provider list | connections hold API keys → strictly per-user |
| Runbooks | `runbook` (drafts visible to owner only), `runbook_run`, schedules, per-user `runbook_settings` | **published** runbooks | run/schedule owner = the runner, not the author |
| History | run rows | — | per-user |
| Prompt Library | prompts, folders | **published** prompts / gallery | moves server-side (§3.5) |
| Settings | per-user prefs (theme stays client) | instance settings (admin: providers enabled, retention caps, concurrency) | `llm_settings` / `runbook_settings` split into `instance_*` + `user_*` |

**Migration:** first `--auth on` boot against an existing DB → every `NULL`
`owner_id` row is assigned to the bootstrap admin.

### 3.5 Prompt Library server-side

- New tables in `auth.db` or a `prompt.db`: `prompt`, `prompt_folder`,
  `prompt_version` — mirror `core/prompt/**` shapes, `owner_id` scoped,
  `published` flag for the shared gallery.
- `/prompts/*` endpoints (list / get / put / delete / versions / publish).
- Client: `promptRepository` gets a `BackendPromptRepo` alongside the current
  `LocalPromptRepo`; `authMode == on` → backend, `off` → local. The rest of
  the Prompt Library UI is unchanged.

### 3.6 Frontend (`app/`)

- `stores/authStore.ts` — `mode` (from `/health`), `session` token
  (`localStorage`), `me` (`{id, username, role, allowedModules}`), `login` /
  `logout` / `changePassword` / `bootstrap`. 401 from `backendClient` →
  `logout()` + redirect to `/login`.
- `<RequireAuth>` route wrapper; `/login` + `/setup` (first admin) screens.
- Top-bar user menu — name, role, "Change password", "Sign out".
- Rail + routes filtered by `me.allowedModules` (falls back to full taxonomy
  when `mode == off` or `allowedModules == null`).
- Pairs with `S3f`: point at a backend → `authMode: on` → show `/login`
  instead of the "no backend" banner.
- Vault dialog already prompts for a passphrase — unchanged, just per-user now.
- Everything auth-related is dead code when `mode == off`.

### 3.7 TLS (`internal/server` + client)

- `--tls auto` → backend generates a self-signed cert on first run
  (`server.crt` / `server.key` in the config dir), serves HTTPS, prints
  `FINGERPRINT sha256:…`.
- Desktop: the sidecar hands the fingerprint to the webview alongside the
  endpoint; `fetch` / `fetchEventSource` verify it (Tauri: a custom cert
  verifier; web: the browser will warn once, user accepts — documented).
- `--tls <cert> <key>` → bring your own. `--tls off` → plain HTTP (loopback
  only; refused for non-loopback binds when `--auth on`).

### 3.8 Audit

`auth.Audit(ctx, action, target, meta)` at: login ok/fail, logout, bootstrap,
user create / disable / role change / module change / password reset, vault
unlock, runbook run start, runbook approve / deny, secret write, llm
connection write. `GET /audit` (admin, paginated, filterable).

---

## 4. Phases

Each phase is a green checkpoint; commit per checkpoint bullet.

| Phase | Scope | Milestone |
|-------|-------|-----------|
| **U0** ✅ `711c812` | `internal/auth` (auth.db `auth_user`/`auth_session`/`auth_audit`, Argon2id PHC hashes, opaque sha256-at-rest session tokens w/ 14d sliding expiry, in-memory login throttle, append-only audit, last-admin guard); `--auth` + `--auth-db` flags; `/health` `authMode`; `sessionAuth` + `accessGuard` (viewer write-gate + per-user module ACL via `moduleOf`) middleware; `/auth/*` + `/users` + `/audit`; bootstrap-via-`SETUP-TOKEN`. **No data scoping** — auth on = login wall, data shared. 7 tests, curl-verified. | Backend auth works. |
| **U1** ✅ `458996a` | Frontend: `authStore` (mode from `/health`, session in `localStorage`, 401→drop), `backendClient`/`sseClient` session-token priority, `App.tsx` gate → `<AuthGate>` (login + first-run setup screens), `<UserMenu>` (role / change-pw / sign-out), rail + shell-route filter by `me.allowedModules`, admin-only Settings → **Users** (list / create / role / disable / delete / module-access checkboxes / password reset). `--auth off` = no auth UI, full rail, unchanged. Browser-verified. | **Login end-to-end; team can share the backend, all data still common.** |
| **U2** ✅ `7557fbb` (U2a) + `8a2bad8` (U2b) | **U2a** `internal/userctx` (user id on ctx) · `vault.Registry` (one `*Vault` per user, `vault/<id>.enc`, `""` = legacy `vault.enc`) · the 3 `SecretResolver` ifaces gain a ctx arg, threaded through `engine.resolveKey` / mcp `transport`+`buildEnv` / orchestrator `BuildPreview`+`buildExecutorStep`+`Run` · `VaultHandlers`/`RunbookHandlers`/`main.go` wired. **U2b** `owner` column + filter on `llm_connection`/`llm_task`/`mcp_server`/`llm_conversation`/`llm_usage` (additive ALTER; `owner=''` = pre-auth) · store methods take `owner`, handlers pass `owner(r)` · mcp Manager re-checks `store.Get` before reusing a cached session · `Service.OnBootstrap` → `main.go` claims orphans for the first admin. `--auth off` = `owner`/`userctx` are `""` → no-op, byte-identical. Curl-verified: per-user connections + vaults isolated, cross-user DELETE → 404, single-user legacy vault path intact. | Per-user AI + secrets. |
| **U3** ✅ `906bef4` | `owner` on `runbook`/`run`/`ssh_node`/`runbook_schedule` (orchestrator.db) + `run` (history.db); runbook visibility = published ∪ own ∪ orphan, drafts owner-only; `RunbookOwner` guard on mutations; `ImportLibrary`/`ExportLibrary` scoped. **Approval gate**: `Spec.RequiresApproval` → run parks `awaiting_approval`, SSE `approval-required`, blocks on `Engine.awaitRunApproval` (30 min); `POST /runs/{id}/approve` (refused for the starter → 403), `GET /runs/pending-approvals`. FE: editor "needs approval" toggle, RunPanel Waiting state, Approvals console tab (multi-user only). Curl-verified full flow. | Per-user runbooks + shared published + approvals. |
| **U4** ✅ `41ef0a1` | `internal/promptstore` (`prompt`/`prompt_folder`/`prompt_template` JSON blobs in llm.db, owner-scoped, `published`). `/prompts/*` mounted only with `--auth on`; cross-user save → 404. FE `BackendPromptRepository` + `ModeAwarePromptRepository` dispatching per call by `authStore.mode` — local `IStoragePort` repo unchanged for solo. Curl-verified isolation + publish. | Per-user prompts + shared templates. |
| **U5** ✅ `d6b9aa4` | `userctx` carries role+username; `requireAdmin` on `PUT /llm/settings` + `PUT /runbook-settings`. `api.audit(r,…)` sink → `auth.Service.AuditRaw`; hooks: runbook run / approve / deny, vault unlock, secret write, connection write. FE: admin-only **Audit log** section; `<ForcedPasswordChange>` on `me.mustChangePw`; `<InstanceSettingsNotice>` on AI/Runbooks sections. (Users editor already full from U1.) | Manageable. |
| **U6** ✅ `505de32` | `internal/tlscert` — `--tls auto` self-signs (10y ECDSA, localhost/127.0.0.1/::1 + bind-host SANs), prints `FINGERPRINT sha256:…`; `--tls <cert> --tls-key <key>` BYO; `ServeTLS`; `/health` `{tls,fingerprint}`. **Hard gate**: `--auth on` + non-loopback bind + no TLS → fatal. `--cors-origin` allowlist. FE: Backend settings show Transport + fingerprint. Curl-verified. Deferred: Tauri desktop cert verifier (loopback sidecar needs none). | Safe to deploy off-box. |

**All phases done.** Solo desktop (`--auth off`) is byte-identical throughout.

---

## 5. Security checklist

- Plain HTTP + real passwords = a regression — **U6 (TLS) is mandatory before
  any remote deployment**, and `--auth on` refuses non-loopback binds without
  TLS.
- Session tokens: 256-bit, SHA-256 at rest, sliding expiry, revoked on
  logout / disable / password change; never readable by tool-screen code.
- Login: per-username + per-IP throttle, lockout, constant-time compare,
  generic error text.
- Argon2id params tuned + recorded (same as the vault).
- Bootstrap admin: one-time setup token printed once, forced password change
  on first login; never an env var or CLI arg.
- CORS allowlist under `--auth on`.
- `audit_log` append-only through the API.
- Per-user vault isolation is cryptographic (separate files, separate keys) —
  an admin cannot read another user's secrets, only reset their login.

---

## 6. Roadmap / deferred

- **S3e cross-device sync** — now *possible* on the account layer; build only
  if requested. Stays parked in `ROADMAP.md`.
- **SSO / OIDC / LDAP** — enterprise, dependency-heavy, explicitly out.
- **Per-resource ACL** ("share this one runbook with user X") — base model is
  owner + role + published; finer sharing is a later ask.
- **Per-user quotas / rate limits** — later.
- **Email** (self-serve password reset) — admin resets manually in v1.

## 7. Dependencies

**None new.** Argon2id (`x/crypto/argon2`), `crypto/tls`, `modernc.org/sqlite`
are all already in the tree.
