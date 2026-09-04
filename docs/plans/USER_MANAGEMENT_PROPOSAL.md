# User management — proposal (not a plan yet)

Status: **draft for review, 2026-09-01.** This is a proposal to read and react
to, not an approved build plan. It ends with a **Decisions needed** section —
answer those and it becomes a phased `USER_MANAGEMENT_PLAN.md`.

---

## 1. The tension

InfraKit Studio has been deliberately **single-user and account-free** the
whole way:

- The original spec's client-first constraint (§5).
- `S3e` cross-device settings sync was **killed** — "standalone app, no
  account layer wanted."
- The backend's entire auth model is **one per-launch bearer token** — printed
  at startup, handed to the Tauri sidecar, "whoever can reach the port is in."
- The Vault is **one** `vault.enc` with **one** RAM-only key.

Adding user management is a real architectural pivot. Before writing a plan we
should be honest about *why* — the answer changes almost everything below.

---

## 2. What "user management" could mean

Three genuinely different products. Pick the driver (or say it's a mix):

### A. Lock the shared backend behind a login
`S3f` just made it trivial to point a hosted web build (or someone else's
desktop app) at **one shared backend** on a bastion / jump host. Right now that
backend is protected only by a static token that has to be shared verbatim.
"User management" here = **real per-person credentials + session tokens +
revocation**, so you can hand teammates access without sharing one secret, and
cut someone off without restarting the service. Everything stays *shared* —
same runbook library, same connections, same vault — you just know who's
knocking.

### B. Multi-tenant shared backend
Same shared-backend deployment, but now each user gets their **own** prompt
library, LLM connections, runbook runs, schedules, secrets, history, and
preferences. The backend becomes multi-tenant: every table grows an
`owner_id`, every query filters. This is where the deferred **Runbooks
multi-user approvals** and an **audit log** ("who ran what, when") actually
land.

### C. Local profiles on a shared desktop install
A lab / kiosk / shared-workstation machine where several people use one OS
login and want their own separated workspaces. Much rarer for a tool like
this, and mostly solvable with OS user accounts already. **Probably not worth
building** unless you specifically want it.

**My read:** the real driver is **A, growing into B**. C is a distraction.

---

## 3. Recommended shape

**Opt-in "multi-user mode", backend-first, off by default.**

- A solo operator on their desktop sees **zero change** — no login screen, no
  users, the sidecar token model is untouched. This is non-negotiable: we
  don't tax the 90% case for the 10%.
- The backend gets an `--auth` flag (or a stored instance setting):
  - `--auth off` (default) — today's behaviour exactly.
  - `--auth on` — every `/api/v1/*` call (except `/health` and `/auth/login`)
    requires a valid **session token**; first run bootstraps one admin account
    from an env var or an interactive prompt.
- The frontend learns the mode from `/health` (`authMode: "off" | "on"`). When
  `off`, the entire auth layer is dead code paths — never rendered.
- Scope grows in phases: **A first** (login wall, everything still shared),
  **B later** (per-user data) only if wanted — see §6.

This keeps the pivot reversible and lets us ship value (A) before committing to
the invasive part (B).

---

## 4. Architecture sketch

### 4.1 Identity core (backend, new `internal/auth/`)

- **Storage:** a new `auth.db` (pure-Go `modernc.org/sqlite`, sibling of
  `llm.db` / `orchestrator.db`), or new tables in an existing DB. Tables:
  - `user` — `id, username, email?, password_hash, role, disabled, created_at,
    updated_at`.
  - `session` — `token_hash, user_id, created_at, expires_at, last_seen_at,
    user_agent?`. Opaque random token (32 bytes, base64url), **hashed at
    rest** (SHA-256 is fine for a high-entropy token), sliding expiry.
  - `audit_log` — `id, user_id, action, target, at, meta_json`.
- **Passwords:** Argon2id — the exact same primitive the Vault already
  vendors (`golang.org/x/crypto/argon2`). No new dependency.
- **Sessions, not JWT.** Opaque tokens in a table are revocable, simple, and
  need no key management. `Authorization: Bearer <session-token>` — same
  header shape the client already sends, so the transport code barely changes.
- **Roles (minimal RBAC):** `admin` (manage users, see audit, instance
  settings) · `operator` (run everything) · `viewer` (read-only). Start here;
  per-resource ACLs are a later, separate ask.
- **Login hardening:** per-username + per-IP failed-attempt throttle
  (exponential backoff, lock after N), constant-time hash compare, generic
  "invalid credentials" message.
- **Endpoints:** `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`,
  `POST /auth/change-password`, `GET/POST/PATCH/DELETE /users` (admin),
  `GET /audit` (admin).
- **Middleware:** a new `sessionAuth` that replaces `bearerAuth` when auth is
  on — validates the session, bumps `last_seen_at`, injects the `*User` into
  the request context. Handlers that need role checks read it.

### 4.2 Data scoping (backend — the invasive part, phase B only)

Every user-owned table gets `owner_id` and every read/write filters by the
context user:

| Area | Table(s) | Notes |
|------|----------|-------|
| AI | `llm_connection`, `llm_conversation`, `llm_task`, `mcp_server`, `llm_usage` | connections carry API keys → must be per-user |
| Runbooks | runbooks?, `runbook_run`, schedules, `runbook_settings` | **library shared** (publish gate already exists), runs/schedules per-user |
| Prompt Library | `promptRepository` keys | today client-side `IStoragePort` — moving to backend is its own migration |
| History | `history.db` runs | per-user |
| Settings | `llm_settings` etc. | split: **instance** (admin) vs **per-user prefs** |

**Migration:** first time `--auth on` runs against an existing single-user DB,
every existing row is assigned to the bootstrap admin.

### 4.3 The Vault problem

Today: one `vault.enc`, one Argon2id-derived RAM key, one auto-lock timer.
Multi-user needs a decision (see §7):

- **Per-user vault (recommended):** `vault/<user-id>.enc`, each unlocked with
  that user's own vault passphrase, each with its own RAM key + auto-lock. The
  existing `internal/vault` becomes a *registry of* `*Vault` keyed by user.
  Cleanest isolation; a user's secrets are cryptographically theirs.
- **Shared vault + ACL:** one vault, secrets tagged with an owner/visibility.
  Less code churn, weaker isolation, and "shared team secrets" fall out
  naturally — but every secret read now needs an ACL check and the single RAM
  key means unlocking is all-or-nothing.

### 4.4 Frontend (`app/`)

- `stores/authStore.ts` — session token (storage choice in §7), `me` (user +
  role), `login` / `logout` / `changePassword`, `mode` from `/health`.
- `<RequireAuth>` route wrapper; a 401 from `backendClient` clears the session
  and bounces to `/login`.
- `LoginScreen` (username + password; first-run "create admin" variant).
- User menu in the top bar — name, role, "Change password", "Sign out".
- Settings → **Users** section (admin only): list / create / disable / reset
  password / set role. **Audit** viewer.
- Pairs with `S3f`: point at a backend → if it says `authMode: on`, show the
  login screen instead of the "no backend" banner.
- Everything gated on `authStore.mode === 'on'` — solo desktop renders none of
  it.

### 4.5 Approvals + audit (phase B/C payoff)

- Wire the deferred **Runbooks multi-user approval**: a run of a runbook
  flagged `requiresApproval` pauses on an SSE `approval-required` event and
  waits for a *different* operator+ to `POST /runs/{id}/approve` — reuses the
  exact pause/resume pattern from the A4c tool-approval flow.
- `audit_log` entries for: login / logout, runbook run start, vault unlock,
  user create/disable/role-change, secret write, connection write.

---

## 5. Security — the part that must not be hand-waved

Adding real credentials to an app whose backend currently speaks **plain HTTP**
is a step *down* in safety unless transport is fixed:

- **TLS is mandatory for `--auth on` beyond loopback.** Options: (a) the
  backend terminates TLS itself (cert path flags, or a self-signed cert it
  generates + a fingerprint the client pins — mirrors the SSH host-key pinning
  Runbooks already does); (b) document "run it behind a reverse proxy
  (Caddy/nginx) that does TLS" and refuse non-loopback binds without it. I
  lean (a)-with-pinning as the default, (b) documented for real deployments.
- Session tokens: 256-bit, hashed at rest, `HttpOnly`-equivalent handling on
  the client (not readable by tool screens), sane expiry + sliding renewal,
  server-side revocation on logout / disable / password change.
- Login throttling + lockout (§4.1).
- Argon2id params tuned (time/memory) and recorded, same as the Vault.
- CORS today reflects any origin — with auth on, tighten to a configured
  allowlist (the `S3f` override URL's origin, plus configured extras).
- The bootstrap admin password must never be a compiled-in default; env var or
  interactive first-run only, forced change on first login.
- Audit log is append-only; admins can read, nobody can edit via the API.

---

## 6. Phasing

| Phase | Scope | Ships value? |
|-------|-------|--------------|
| **U0** | Identity core: `internal/auth`, `auth.db`, Argon2id passwords, session tokens, `sessionAuth` middleware, `--auth` flag + `/health` `authMode`, login throttling, bootstrap admin. **No data scoping** — auth on = a login wall, all data still shared. | Scenario **A** fully. |
| **U1** | Frontend auth: `authStore`, `<RequireAuth>`, `LoginScreen`, user menu, 401 handling. Solo mode renders nothing. | A is usable end-to-end. |
| **U2** | TLS: self-signed cert generation + client fingerprint pinning (or documented reverse-proxy path), CORS allowlist. | A is *safe* to deploy off-box. |
| **U3** | Admin UI: Settings → Users (CRUD, roles, disable, reset) + Audit viewer. `audit_log` writes across the app. | A is manageable. |
| **U4** | Data scoping (**scenario B**): `owner_id` on AI / Runbooks-runs / History / per-user settings, query filters, migration assigns existing rows to admin. Per-user vault registry. | B. Big. |
| **U5** | Runbooks multi-user approval gate (reuses A4c pause/resume). | B payoff. |

**U0–U3 = scenario A, and can ship without ever doing U4.** That's the natural
stopping point to re-evaluate.

---

## 7. Decisions needed before this becomes a plan

1. **Driver:** Is this scenario **A** (login wall on a shared backend), **B**
   (per-user data too), or **C** (local desktop profiles)? A-growing-into-B is
   my assumption.
2. **Default:** Confirm `--auth off` by default, solo desktop untouched. (I
   strongly recommend yes.)
3. **Stop point:** Ship **U0–U3 (A) first**, decide on U4 (B) afterward? Or is
   per-user data non-negotiable from day one?
4. **Vault:** per-user vault files (recommended) or shared vault + per-secret
   ACL?
5. **Login password vs vault passphrase:** one credential or two? Two is safer
   (login ≠ decrypt), one is less friction. I lean **two**.
6. **Web session storage:** `localStorage` (survives restart, less safe) or
   `sessionStorage` (per-tab, re-login often)?
7. **TLS approach:** backend self-signs + client pins the fingerprint
   (recommended, matches the SSH model), or "bring your own reverse proxy"
   only?
8. **Prompt Library:** it's client-side (`IStoragePort`) today. In scenario B,
   does it move to the backend (a real migration), or stay local-per-device
   and simply not sync?
9. **Does this reopen `S3e`?** Accounts make cross-device sync *possible*;
   we're not obligated to build it. Park it again, or fold it in?
10. **RBAC depth:** is `admin / operator / viewer` enough for v1, or do you
    already know you need per-runbook / per-connection sharing?

---

## 8. Rough effort

- **U0** — M–L (new subsystem, but small: ~800 lines Go + tests).
- **U1** — M (auth store + login + wiring; no visual complexity).
- **U2** — M (TLS + pinning is fiddly but bounded).
- **U3** — M (another Settings section + audit table + write-sites).
- **U4** — **L / multi-day grind** (touches every backend table and query,
  plus the vault registry, plus a data migration).
- **U5** — S–M (reuses the approval pattern).

Scenario **A (U0–U3)** is a focused ~1-week-ish effort. Scenario **B** roughly
doubles it and carries migration risk.

---

## 9. New dependencies

None expected. Argon2id (`x/crypto/argon2`), TLS (`crypto/tls`), SQLite
(`modernc.org/sqlite`) are all already in the tree. If we want OIDC/LDAP/SSO
later that's a separate, dependency-heavy conversation — explicitly **out of
scope** here.
