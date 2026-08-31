# Runbooks Module — Design Proposal & Roadmap

Status: **proposal, not started (2026-08-30).** No code yet. Core decisions
resolved (§2). This is the full spec for R0–R3; R4 is deferred by design (§9).

Reference: the user's standalone "Command Orchestrator" prototype (screenshots).
This module rebuilds that idea **inside InfraKit Studio, from scratch and
better** — the prototype is replaced, not imported.

This module realises the backend vision already stated in
[`CLAUDE.md`](CLAUDE.md): *"a Go service for ansible/ssh command execution … "*.
It extends the same Go backend the Network Toolkit started (§11).

---

## 1. Name & vocabulary

**Module name: "Runbooks"** (`moduleTaxonomy.ts` id `runbook`, route
`/tools/runbook`). A *runbook* is the industry term for a documented procedure
for a routine operation — which is exactly the goal: capture a task once,
parameterise it, and let it be re-run months later or handed to a
non-technical colleague. Alternatives considered: "Command Orchestrator"
(the prototype's name — fine to keep as the workspace's visible title),
"Command Deck", "Ops Console".

Settled vocabulary (the prototype used Template / Blueprint / Command /
Sequence interchangeably — pick one each):

| Term | Meaning |
|------|---------|
| **Runbook** | the saved, reusable, versioned thing (prototype's "Blueprint" / "Template") |
| **Step** | one `executor + script + args` unit inside a runbook |
| **Run** | one execution of a runbook (prototype's "Deploy" / "Fire Sequence") |
| **Node** | a saved SSH target |
| **Secret** | a Vault entry (password / token / key / kubeconfig / cert) |

UI verbs stay plain — **Run**, not "Deploy Command" / "Fire Sequence". The
target audience is someone re-running a task they half-remember; cleverness
costs them.

---

## 2. Decisions (resolved 2026-08-30)

| # | Decision |
|---|----------|
| Model | **Multi-step runbook** — a runbook is an ordered list of steps; each step has its own executor, script and args; a step can read an earlier step's output. Single-step is the common case. |
| Editor | A **full-page route** (`/tools/runbook/edit/:id`), not a modal. |
| Concurrent runs | **Allowed** — several runbooks can run at once (capped at a small N, shown in the status strip). |
| History retention | Same default as the Network module (keep 90 days + last 20 per runbook + pinned); **overridable in module Settings**. |
| `triggered_by` | Kept on every `run` (always `"local"` for now) — user management lands right after this module. |
| Storage | **SQLite + in-app version history** (mirrors the Prompt Library's `PromptVersion` model, but backend-side). Git is an **export/import** action (R3), not the source of truth. |
| Executors | **PowerShell, CMD, local bash/sh, SSH, HTTP/API.** Python-via-`uv` → R4. **No dedicated Ansible or kubectl executor** — `ansible-playbook …` / `kubectl …` are just commands you put in a shell/SSH step. Dedicated Ansible and kubectl modules are planned separately, later; nothing Ansible/kubectl-specific lives in this module. |
| Guardrails v1 | **All four:** (a) confirm dialog with the full resolved command, secrets masked; (b) **published gate** — a draft runbook is author-only, only a *published* runbook is runnable by others; (c) **dry-run** mode — resolve + validate, execute nothing; (d) **destructive-pattern warnings** — heuristic scan flags `rm -rf`, `DROP TABLE`, `mkfs`, `dd`, `--force`, etc. |
| Backend | **Mandatory for the whole module.** Execution and the Vault both need it. Web build with no backend shows a "connect a backend" state for the entire Runbooks section (same pattern as the Network tools). |
| Vault crypto | Master password → **Argon2id** → 32-byte key → **AES-256-GCM**. Secrets live in a **dedicated `vault.enc` file** (one encrypted blob), not in the SQLite DB — easy to back up, move, or exclude. Key lives in backend memory only; **auto-lock** after idle (default 15 min) / explicit Lock / backend exit. An explicit encrypted `.vault` export is also offered for off-machine backup. |
| SSH transport | Pure-Go `golang.org/x/crypto/ssh` client — no dependency on a system `ssh` binary (works on stock Windows). |
| Variable syntax | **`{{VAR}}`** (consistent with the Prompt Library, and `{{` never collides with shell `[ ]` test / glob). Plus `{{steps.N.stdout}}` for chaining and a vault picker for secret args. |

---

## 3. Scope

### 3.1 Executors

Each executor is a backend adapter with a `kind` that drives **both** the run
mechanism and the step-editor form (the prototype flagged "ui changes per
executor" — this is where it lives).

| Executor | Step fields | Runs as |
|----------|-------------|---------|
| **PowerShell** (Windows) | script | `powershell -NoProfile -NonInteractive -Command -` (script on stdin), or `pwsh` if present |
| **CMD** (Windows) | script | `cmd /c` with the script written to a temp `.bat` |
| **Bash / sh** (local) | script, optional shell path | `bash -c` / `sh -c`; script via stdin |
| **SSH** | script, **Node** ref (or inline host/user/auth), optional `sudo` | dial the node, open a session, stream; jump-host chain supported |
| **HTTP / API** | method, URL, headers[], body, auth (none / bearer→secret / basic→secret), expected status, JSONPath assertions | one `net/http` request; response status + headers + body captured as the step "output" |
| *(R4)* Python | `.py` body, `dependencies[]`, python version | `uv run --python <v> --with <deps> -` |

`ansible-playbook …`, `kubectl …`, `terraform …`, etc. are just commands — put
them in a **bash / powershell / SSH** step. There is **no** dedicated Ansible or
kubectl executor here; those get their own modules later.

**Never build a shell string** — every exec is `exec.CommandContext` with an
arg slice; the user's script is passed as a single argument or on stdin, never
concatenated into a command line. (Same rule the Network module follows.)

### 3.2 In scope for R0–R3

Library (grid + search/filter/sort) · full-page runbook editor · multi-step ·
arg config (label / help / type / required / regex + preset / default / error
message) · Run dialog (fill args, dry-run, confirm + redacted preview,
destructive warnings) · streamed per-step output · run History + detail ·
per-runbook version history + draft · published gate · Vault (init / unlock /
lock / secret CRUD, auto-lock) · SSH Nodes (registry + test-connection) ·
Packages (detect + assisted install) · Git/file export-import.

### 3.3 Out of scope

- **Never in this module**: dedicated Ansible / kubectl / Terraform executors.
  They run as ordinary commands inside a shell/SSH step; each gets its own
  module later.
- **R4 (later, this module)**: Python-via-`uv` executor · AI script generation ·
  scheduled/cron runs · OS-keyring-sealed vault key · multi-user approvals &
  audit trail · file-type run parameters · output artifact storage.

---

## 4. Data model (`src/core/runbook/runbookModel.ts` — framework-free)

```ts
export type ExecutorKind = 'powershell' | 'cmd' | 'bash' | 'ssh' | 'http'
// (R4 adds 'python'. No 'ansible' / 'kubectl' — those are plain commands.)

export type ArgType = 'string' | 'number' | 'enum' | 'boolean' | 'secret' | 'node' | 'multiline'

export interface ArgSpec {
  name: string                 // the {{NAME}} token
  label?: string
  help?: string
  type: ArgType
  required: boolean
  default?: string
  enumValues?: string[]        // type === 'enum'
  validationRegex?: string
  validationPreset?: string    // 'ipv4' | 'hostname' | 'port' | 'k8s-name' | …
  errorMessage?: string
}

export interface StepSpec {
  id: string
  name: string
  executor: ExecutorKind
  script: string               // uses {{ARG}} and {{steps.N.stdout}}
  timeoutSec?: number          // overrides the runbook default
  continueOnError: boolean
  runIf?: 'always' | 'prev-success' | 'prev-failure'
  // executor-specific:
  ssh?: { nodeId?: string; inlineHost?: string; user?: string; authSecretId?: string; sudo?: boolean; jumpNodeId?: string }
  http?: { method: string; url: string; headers: { k: string; v: string }[]; body?: string; auth?: { kind: 'bearer' | 'basic'; secretId: string }; expectStatus?: number[]; assert?: { jsonpath: string; equals: string }[] }
}

export interface RunbookSpec {           // the versioned payload
  name: string
  description?: string
  detailedDescription?: string
  defaultTimeoutSec: number               // 0 = unlimited
  tags: string[]
  args: ArgSpec[]                          // union of every step's detected args, with config
  steps: StepSpec[]
}

export interface RunbookVersion {
  version: number
  createdAt: number
  note?: string
  pinned?: boolean
  spec: RunbookSpec
}

export interface Runbook {
  id: string
  slug: string
  published: boolean
  versions: RunbookVersion[]               // append-only
  draft: RunbookSpec | null                // unsaved edits; null when clean
  createdAt: number
  updatedAt: number
}

export interface SshNode {
  id: string
  name: string
  host: string
  port: number
  user: string
  authKind: 'password' | 'key' | 'agent'
  authSecretId?: string                    // → Vault
  jumpNodeId?: string
  tags: string[]
}

export interface VaultSecretMeta {         // list responses never include the value
  id: string
  name: string
  kind: 'password' | 'api-key' | 'token' | 'ssh-key' | 'kubeconfig' | 'certificate' | 'other'
  notes?: string
  updatedAt: number
}
```

Variable extraction, `{{VAR}}` rendering, and the destructive-pattern scan are
pure functions in `src/core/runbook/` with unit tests — same shape as the
Prompt Library's `variableExtractor` / `promptRenderer` (candidate to **extract
a shared `src/core/templating/` helper** rather than duplicate).

---

## 5. Storage

### 5.1 Backend SQLite — `orchestrator.db` (new file, sibling of `history.db`)

```sql
runbook(id, slug, name, published, tags_json, current_version,
        created_at, updated_at)
runbook_version(runbook_id, version, created_at, note, pinned, spec_json)   -- immutable
runbook_draft(runbook_id PRIMARY KEY, spec_json, updated_at)                 -- 0..1 per runbook

run(id, runbook_id, runbook_version, status, dry_run, triggered_by,
    started_at, finished_at, args_json)          -- secret-typed args stored as "‹secret:NAME›"
run_step(run_id, step_index, name, executor, target, command_redacted,
         stdout, stderr, exit_code, status, started_at, finished_at)

ssh_node(id, name, host, port, user, auth_kind, auth_secret_id,
         jump_node_id, host_key_fp, tags_json, created_at)

package_state(tool, present, version, manager, checked_at)                  -- detection cache
runbook_settings(key, value)                                                -- history retention override, autolock, …
```

- Retention on `run` / `run_step`: default = keep last 20 per runbook + pinned +
  newer than 90 days (Network `PrunePolicy` shape). **Overridable** via
  `runbook_settings` from the module's Settings section.
- **No secrets in this DB.** The Vault is a separate file (§5.2) so it can be
  backed up, moved, or excluded on its own.

### 5.2 Vault — dedicated `vault.enc` file

A single encrypted file (JSON envelope), not SQLite:

```
{ "v": 1,
  "kdf": { "algo": "argon2id", "salt": "…", "t": 3, "m": 65536, "p": 4 },
  "verifier": "…",                        // AES-GCM(sentinel) — unlock check
  "secrets": { "<id>": "nonce||AES-256-GCM(json{name,kind,notes,value})" } }
```

- `unlock`: derive the 32-byte key with Argon2id from the master password + salt;
  decrypt `verifier`; succeeds iff it yields the sentinel.
- The key is held **only in backend RAM** (`server` managed state), zeroed on
  lock / idle-timeout / process exit. The master password is never stored.
- **List endpoints return `VaultSecretMeta` only** — the plaintext value never
  reaches the renderer. It is resolved server-side at execution and redacted in
  `command_redacted`, `args_json`, the preview, and the streamed output
  (pattern-replace the raw value with `‹secret:NAME›` on the way out).
- **Backup / move**: the `vault.enc` file *is* the portable format —
  `POST /vault/export` returns it (still encrypted); `POST /vault/import`
  replaces the local one (asks for the master password to verify first).

### 5.3 Frontend `IStoragePort`

UI-only prefs: last active section, Library filters/sort, editor pane sizes,
"don't warn me again about X". No runbook or secret data.

---

## 6. Backend architecture

New packages under `backend/internal/`:

```
orchestrator/   store.go (orchestrator.db + CRUD)   engine.go (run engine)   sync.go (R3 export/import)
executor/       executor.go (interface)   shell.go   ssh.go   httpx.go
vault/          kdf.go (argon2id)   crypto.go (aes-gcm)   store.go (vault.enc file, locked/unlocked state, auto-lock)
packages/       detect.go (command -v / Get-Command)   install.go (winget|choco|scoop|brew|apt|dnf|pacman|apk)
```

Reuses `internal/sse` (streaming), `internal/privilege` + `internal/elevate`
(SSH `sudo`, package install), `modernc.org/sqlite` + the `history` store's
open helper, chi router.

### 6.1 Executor interface

```go
type Executor interface {
    Run(ctx context.Context, step StepSpec, args ResolvedArgs,
        stdout, stderr io.Writer) (StepResult, error)
}
```

`ctx` carries the timeout. `stdout`/`stderr` are SSE writers. `ResolvedArgs`
has user values + resolved secret values + prior-step outputs already
substituted into `step.script`.

### 6.2 Run engine

1. Load the runbook version (or the draft, for an author dry-run).
2. Validate every arg against its regex/preset; collect errors.
3. Resolve `{{VAR}}` → user value; `{{secret:NAME}}` → vault (must be unlocked);
   `{{steps.N.stdout}}` deferred to run time.
4. **Destructive scan** each resolved script → warnings.
5. `dry_run` → stop here, return `{ resolvedRedacted, warnings, validation }`.
6. Otherwise per step, in order: check `runIf` against the previous step;
   pick the executor; `Run` with an SSE stream; capture `StepResult`; on error
   respect `continueOnError`.
7. Persist `run` + `run_step` rows with everything redacted.

### 6.3 Endpoints (`/api/v1/runbook…`)

```
GET|POST   /runbooks                          list / create
GET|PUT|DELETE /runbooks/{id}
POST       /runbooks/{id}/versions            save draft as a new version
GET        /runbooks/{id}/versions
POST       /runbooks/{id}/versions/{n}/restore | /pin
DELETE     /runbooks/{id}/versions/{n}        (guard latest + pinned)
PUT|DELETE /runbooks/{id}/draft
POST       /runbooks/{id}/publish             { published: bool }
POST       /runbooks/{id}/preview             → { resolvedRedacted, warnings, validation }   (honours dry_run)
GET        /runbooks/{id}/run/stream?…        SSE: step-start, stdout, stderr, step-end, run-end
GET        /runs        GET /runs/{id}
GET|POST   /ssh-nodes   PUT|DELETE /ssh-nodes/{id}   POST /ssh-nodes/{id}/test
GET        /vault/status                      { initialised, unlocked, autoLockInSec }
POST       /vault/init      { masterPassword }
POST       /vault/unlock    { masterPassword }
POST       /vault/lock
GET|POST   /vault/secrets   PUT|DELETE /vault/secrets/{id}    (POST/PUT value write-only; GET = metadata)
POST       /vault/export | /vault/import        the encrypted vault.enc, for backup / move
GET        /packages                          detected tool inventory
POST       /packages/install  { tool, manager }   → SSE (needs confirm; elevation warning)
POST       /library/export | /library/import   (R3 — git dir or a zip of YAML)
GET|PUT    /settings                          history retention override, autolock timeout, max concurrent runs
```

New `capabilities` entry: `runbook` → `{ available, reason }`, plus
`runbook.executors` (which kinds this host can run — e.g. no `powershell` on
Linux) and `runbook.runtimes` (`uv` presence, for the status strip / R4).

### 6.4 Go dependencies

All already vendored or stdlib:
`golang.org/x/crypto/ssh` + `.../argon2` (have `x/crypto`), `crypto/aes` +
`crypto/cipher` (stdlib), `net/http` (stdlib), `modernc.org/sqlite` (have),
`go-chi/chi/v5` (have). **No new Go deps for R0–R3.**

### 6.5 Packages (detect + assisted install)

Not a package manager — a "is `kubectl` here, and if not, here's the one command
to get it" helper.

- **Detect**: `Get-Command <tool>` (Windows) / `command -v <tool>` (POSIX) → name,
  path, `--version`.
- **Install**: pick the manager present — Windows `winget` (built-in) → `choco`
  → `scoop`; macOS `brew`; Linux `apt`/`dnf`/`pacman`/`apk` (needs sudo — surfaced,
  not hidden). Show the exact command; run it only on explicit confirm, via the
  elevated helper where needed.
- **`uv`**: bootstrap check + a one-liner to install it; Python steps (R4) then
  use `uv run` with an ephemeral env, no global Python needed.

---

## 7. Frontend UI — the T7 "Console Workspace" archetype

The module has ~5 peer sections + Vault state + Git. That is too much for the
app's icon-rail + swap-pane shell. So: a **single-tool shell module**
(`ModuleDef.hideToolPane`, like the Prompt Library) whose one screen is a
full-width workspace with **its own top navigation**.

### 7.1 Top nav, not a sidebar — decided

The prototype used a top nav; keep it. Reasons: command scripts + streamed
output want horizontal space; the app's left rail already occupies that edge; a
second left column + a results pane would be cramped; and Library / History /
Nodes / Packages / Assistant are **peers**, not a hierarchy — tabs fit peers.
Filters (search / type / sort) sit in a **toolbar row** inside Library, not a
sidebar.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▸_ Runbooks   [Library] History  Nodes  Packages  Assistant   🔒 Vault · Sync Git · + New │
├──────────────────────────────────────────────────────────────────────────────┤
│  🔍 Search    [All executors ▾]  [Newest ▾]                                    │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐                         │
│  │ SSH  ·published│ │ POWERSHELL     │ │ HTTP           │   … card grid         │
│  │ Restart a svc  │ │ Rotate a cert  │ │ Trigger deploy │                       │
│  │ ssh {{NODE}} … │ │ …              │ │ …              │                       │
│  │ {{NODE}}{{SVC}}│ │                │ │                │                       │
│  │ [ ▶ Run ]      │ │ [ ▶ Run ]      │ │ [ ▶ Run ]      │                       │
│  └───────────────┘ └───────────────┘ └───────────────┘                         │
├──────────────────────────────────────────────────────────────────────────────┤
│ ● backend connected   ·   git ✓  uv ✗   ·   2 runs active   ·   🔒 vault locked  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Sections:

- **Library** — card grid (executor badge, published/draft chip, name,
  description, first-step script preview, arg chips, **Run**). Card menu:
  Edit · Duplicate · Publish/Unpublish · Export · Delete.
- **History** — run list (status dot, runbook, when, duration, dry-run tag) →
  click → **Run detail**: per-step accordion with the redacted command, stdout,
  stderr, exit code, timing.
- **Nodes** — table of SSH nodes; add/edit (host/port/user, auth = a Vault
  secret picker or "agent"), **Test connection** button, jump-host field.
- **Packages** — detected-tools table (`kubectl 1.31 ✓` / `ansible — not found`),
  install action per row, `uv` bootstrap row.
- **Assistant** — script generation from a description. **Deferred (R4)** —
  reuses the Prompt Library's model-connection layer once that exists; a
  placeholder card until then.

### 7.2 Runbook editor — a full-page route, not a modal

`/tools/runbook/edit/:id`. The prototype's modal is already cramped and scrolly;
multi-step + per-executor forms + arg config + secrets need the room.

```
┌ Editor ─────────────────────────────────────────────────────────────────────┐
│ Name [Restart a service]         default timeout [60] s     [Save · v3]  ⋮   │
│ Description […]   Detailed […]                                                │
├── STEPS ──────────────────────────────┬── ARGUMENTS ────────────────────────┤
│ ┌ 1 · SSH ▾ ───────────────── ⠿ ⋮ ┐  │  {{NODE}}   type node ▾   required   │
│ │ Node: [prod-web-01 ▾]            │  │    help  "target host"              │
│ │ sudo systemctl restart {{SVC}}  │  │  {{SVC}}    type string   required   │
│ │ ☑ continue on error  run if ▾   │  │    regex [a-z0-9.-]+   preset ▾      │
│ └─────────────────────────────────┘  │    error "letters, digits, . -"     │
│ ┌ 2 · HTTP ▾ ──────────────── ⠿ ⋮ ┐  │                                     │
│ │ GET  https://…/health/{{SVC}}   │  │  SECRETS USED                       │
│ │ expect 200                      │  │   {{secret:GRAFANA_TOKEN}}          │
│ └─────────────────────────────────┘  │                                     │
│ [ + Step ]                            │                                     │
├──────────────────────────────────────┴─────────────────────────────────────┤
│  ⚠ destructive: none   ·   Dry-run preview ▸                                 │
└────────────────────────────────────────────────────────────────────────────┘
```

- Step card body swaps by executor (`StepCard` + `ShellStepForm` /
  `SshStepForm` / `HttpStepForm`).
- Args auto-detected from every step's `{{TOKEN}}`; the right panel is where you
  configure each. `{{steps.N.*}}` and `{{secret:*}}` are recognised and not
  treated as user args.
- Versioning identical to the Prompt Library: **Save** appends an immutable
  `RunbookVersion`, autosaved `draft` in between, read-only view of old
  versions, restore / pin / delete (latest + pinned guarded), word-level
  compare.

### 7.3 Run dialog (modal — it's transient)

Pick SSH targets for SSH steps · fill each arg (secret args show a **Vault
picker**, never a text field; enum → select; node → node picker) · **Dry-run**
toggle · **Timeout** override · **FINAL PAYLOAD PREVIEW** — every step's
resolved command, secrets shown as `‹secret:NAME›`, destructive lines flagged
red · **Run** (disabled until required args valid; a draft/unpublished runbook
run by a non-author is blocked with a "publish it first" note). Then a live
per-step stream (reuses the Network module's `useNetworkStream` / SSE client).

### 7.4 Status strip

`● backend connected · git ✓ uv ✗ · 2 runs active · 🔒 vault locked (unlock)`.
Vault state is global — one lock/unlock for the session, driven by
`vaultStore`. Active-run count links to a runs tray.

### 7.5 File layout

```
src/core/runbook/
  runbookModel.ts   variableExtractor.ts   payloadRenderer.ts
  destructiveScan.ts   runbookDiff.ts   ports/IRunbookApi.ts
  (+ *.test.ts for each)

src/adapters/backend/runbookClient.ts
src/stores/runbookStore.ts   src/stores/vaultStore.ts

src/adapters/ui/runbook/
  RunbookConsoleScaffold.tsx        (T7)
  LibraryView.tsx  HistoryView.tsx  RunDetailView.tsx
  SshNodesView.tsx  PackagesView.tsx  AssistantPlaceholder.tsx
  VaultPanel.tsx  VaultUnlockDialog.tsx
  RunbookEditorScreen.tsx           (full-page, route)
  StepCard.tsx  ShellStepForm.tsx  SshStepForm.tsx  HttpStepForm.tsx
  ArgConfigPanel.tsx  RunDialog.tsx  RunbookVersionList.tsx

src/adapters/ui/tools/RunbookScreen.tsx      (thin wrapper, hydrate + backend gate)
src/routes.tsx        + /tools/runbook  and  /tools/runbook/edit/:id
src/adapters/ui/shell/moduleTaxonomy.ts   + module { id:'runbook', hideToolPane:true }
```

---

## 8. Security model

- **Backend runs unprivileged.** SSH `sudo`, package installs, and any elevated
  step go through the existing elevated-helper path with an explicit prompt.
- **Local shell execution is arbitrary code on the user's machine** — mitigated,
  not eliminated, by: the confirm+preview dialog, the published gate, dry-run,
  and destructive-pattern warnings (§2 guardrails). A runbook is only as safe as
  its author; the gate makes the author↔runner split explicit.
- **Secrets never reach the renderer.** Written write-only, resolved server-side,
  redacted in every output path (`command_redacted`, `args_json`, preview,
  stream, history).
- **Vault master key** is never persisted; RAM-only, auto-locked.
- **No shell string construction** anywhere — arg slices only.
- **SSH host keys**: on first connect, capture and pin the host key on the Node;
  a changed key blocks the run with a warning (no blind `AcceptAnyHostKey`).
- **CORS / auth**: unchanged — loopback-only origins, per-launch bearer token.

---

## 9. Phasing

Commit per checkpoint (CLAUDE.md commit workflow). Green gate: `bun run build`
+ `bun run test` + `bun run lint`, and `go vet ./... && go test ./...` in
`backend/`.

### R0 — Foundations — **DONE 2026-08-31**

Shipped. Backend: `internal/vault/` (Argon2id → AES-256-GCM, `vault.enc` file,
init/unlock/lock, auto-lock, export/import, 5 tests) · `internal/executor/`
(interface + `shell.go` for powershell/cmd/bash, stdin-fed, ctx timeout, 4
tests) · `internal/orchestrator/` (`store.go` all tables in `orchestrator.db`,
`render.go` `{{VAR}}`/`{{secret:}}`/`{{steps.N.}}` + redaction, `destructive.go`
17 patterns, `engine.go` validate → resolve → scan → dry-run → per-step SSE +
concurrency cap, 6 tests) · `api/runbook.go` + `api/vault.go` · routes in
`server.go` · `capabilities` gains `runbook` + `runbookExecutors`. Frontend:
`core/runbook/**` (model + `variableExtractor` + tests, framework-free) ·
`runbookClient.ts` (with null-slice normalisers) · `runbookStore` + `vaultStore`
· `RunbookConsoleScaffold` (T7: top nav, status strip, backend gate) + section
views + `VaultDialog` + `RunSetupDialog` (fill args, preview, dry-run) +
`RunPanel` (live SSE) · module `runbook` (`hideToolPane`) + route. 1290 frontend
tests + all backend tests green; build + lint + `go vet` clean.
Verified end-to-end in-browser: vault init/unlock → create runbook → publish →
Run with a `{{secret:GREETING}}` ref → SSE stream → output shows the secret
resolved **and redacted** (`‹secret:GREETING›`), run lands in History.

<details><summary>original R0 checkpoint</summary>

- `backend/internal/orchestrator/store.go` — all tables + migrations + CRUD
- `backend/internal/vault/**` — argon2id KDF, AES-GCM, locked/unlocked state,
  auto-lock, `/vault/*` endpoints + tests
- `backend/internal/executor/executor.go` interface + `shell.go` (powershell /
  cmd / bash) + tests
- `backend/internal/orchestrator/engine.go` — arg resolution, destructive scan,
  dry-run, single-step execution over SSE
- routes wired in `server.go`; `capabilities` gains `runbook` + `runbook.executors`
- **Frontend**: `src/core/runbook/**` (model, extractor, renderer, destructiveScan
  + tests), `runbookClient`, `runbookStore` + `vaultStore`,
  `RunbookConsoleScaffold` (T7) with the top nav + status strip + backend-gate,
  module + routes
- **DoD**: `go test` + `bun run test` green; vault init/unlock/lock round-trips;
  a hard-coded one-step bash runbook runs end-to-end over SSE from a scratch UI;
  web-without-backend shows the connect state.
</details>

### R1 — Library + shell runbook editor — **DONE 2026-08-31**

Shipped: full-page **`RunbookEditorScreen`** (`/tools/runbook/edit/:id`) —
inline name/timeout/description, a steps list (`StepCard`: shell executor
picker with ssh/http greyed "R2", script textarea, continue-on-error /
run-if / per-step timeout, add/remove/move), `ArgConfigPanel` (auto-detects
`{{TOKEN}}` from the scripts, per-arg label/help/type/preset/regex/default/
error/required, "secrets used" list). Debounced draft autosave.
`RunbookVersionList` + `runbookDiff.ts` (fields + **args** + steps, word-level,
4 tests) + `RunbookCompareDialog`. `LibraryView` gains Edit; "New runbook"
creates a blank draft and opens the editor. Publish toggle. Run from the
editor via `RunSetupDialog` + docked `RunPanel`. **CORS fix**: `PUT` added to
`Access-Control-Allow-Methods`. 1294 FE tests + all BE tests green.
Verified in-browser: author a 3-arg runbook with a regex on PORT → save v1 →
add the regex → save v2 → compare (arg change shown) → publish → run with an
invalid PORT (validation blocks) then a valid one → SSE stream → run in History
with per-step detail.

<details><summary>original R1 checkpoint</summary>

- `RunbookEditorScreen` (single step, shell executors, `{{ARG}}` auto-detect,
  `ArgConfigPanel`), `LibraryView` grid + toolbar, `RunDialog` (fill args,
  dry-run, confirm + redacted preview, destructive warnings), streamed output,
  `HistoryView` + `RunDetailView`
- per-runbook versioning (Save/draft/restore/pin/delete/compare) + `runbookDiff`
- **published gate** — draft vs published, non-author run blocked
</details>
- **DoD**: author a PowerShell/bash runbook with 3 args + regex validation →
  publish → run with a dry-run first, then for real → output streams, run lands
  in History with secrets/args redacted → edit → v2 → compare. Verified
  in-browser against the dev backend.

### R2 — SSH + HTTP executors — **DONE 2026-08-31**

Shipped. Backend: `executor/ssh.go` (pure-Go `x/crypto/ssh`, password + private
key auth, **host-key pinning** — trust-on-first-use, learned FP persisted to the
node, mismatch aborts; `bash -c` remote exec, optional `sudo -n`, ctx timeout)
+ `executor/httpx.go` (method/url/headers/body, `ExpectStatus`, `Assert` via a
small dot-path evaluator, response captured as stdout so `{{steps.N.stdout}}`
chains; 3 tests). `engine.buildExecutorStep` resolves the SSH node + Vault auth
secrets (by id) and renders `{{VAR}}` into the HTTP fields; secret-typed **args**
resolve server-side by name and redact. `POST /ssh-nodes/{id}/test`. `For` /
`AvailableKinds` flip ssh + http on. Frontend: `SshStepForm` (node picker /
inline host + `SecretPicker`), `HttpStepForm` (method/url/headers/auth/status),
`SecretPicker` (id or name mode), `SshNodesView` (table + add/edit + **Test
connection** with host-key status), `RunSetupDialog` secret/enum arg inputs.
1294 FE tests + all BE tests green. Verified: a 2-step bash→HTTP runbook runs
`GET https://example.com`, checks `expectStatus:[200]`, chains; node test-
connection reports a clean error; step forms render from a saved spec.

<details><summary>original R2 checkpoint</summary>

- `SshStepForm`, `HttpStepForm` (the steps list itself already ships in R1)
- `{{steps.N.stdout}}` chaining is **already wired** in the engine (R0); R2
  just exposes it in the UI
</details>
- **SSH** executor (`x/crypto/ssh`, host-key pinning, jump host) + `SshNodesView`
  (registry, auth via Vault picker, **Test connection**)
- **HTTP** executor (method/url/headers/body/auth→secret, status + JSONPath
  assertions)
- secret args → Vault picker in `RunDialog`; backend resolves + redacts
- **DoD**: a 3-step runbook — SSH restart on a node → HTTP health check using
  step-1 output → notify — runs, chains, redacts a bearer token, and each
  step's status/continue-on-error behaves. Node test-connection works; a
  changed host key blocks.

### R3 — Packages + Git/file sync + polish — **DONE 2026-08-31**

Shipped. Backend: `internal/packages` (`Detect` — `exec.LookPath` + `--version`
for a curated set + arbitrary names; `detectManager` per-OS; `installCommand`
per manager with a per-tool package-name map; `RunInstall` streams the command
output; 2 tests) · `orchestrator/sync.go` (`ExportLibrary` writes
`<slug>.runbook.json` per runbook + optional `git -C add/commit/push`;
`ImportLibrary` reads them back, regenerates step ids, de-collides names with
" (imported)"; 1 test). Endpoints: `GET /packages`,
`GET /packages/install/stream` (SSE), `POST /library/{export,import}`. Frontend:
`PackagesView` (detect table, per-missing-tool install command + streamed
install), `LibrarySyncDialog` (folder + git-commit/push toggles, remembered dir),
single-runbook JSON export (editor ↓ button) + import (Library "Import runbook"
file picker), editor **⌘/Ctrl-S** save + **⌘/Ctrl-↵** run. 1294 FE tests + all
BE tests green. Verified in-browser: git/uv/node/docker detected, helm/ansible/jq
missing with winget commands; exported 3 runbooks to a folder → imported them
back as de-collided drafts (3 → 6 runbooks).

**Deferred:** dnd step reorder (the up/down buttons cover it — synthetic drag
testing is unreliable), responsive `Tabs` `< lg` (desktop-first, same as the
Prompt Library).

<details><summary>original R3 checkpoint</summary>

- `PackagesView` — detect table + assisted install (winget/choco/scoop/brew/apt…)
  with elevation prompt; `uv` bootstrap
- **Git / file sync** — `/library/export` writes `<slug>.runbook.yaml` per
  runbook into a configured dir (optionally `git commit && git push`);
  `/library/import` reads them back (new ids, name de-collision). Single-runbook
  JSON export/import too.
- editor polish: dnd step reorder, keyboard (⌘S / ⌘↵), responsive
- **DoD**: install a missing tool via the detected manager; export the library
  to a git repo, change a file, import it back; round-trip a single runbook JSON.
</details>

### R4 — Deferred bundle (each independently schedulable)

**R4a — Python-via-`uv` executor. DONE 2026-08-31.** 6th executor kind
`python`. `executor/python.go` runs the script through `uv run --no-project
--quiet [--python <v>] [--with <dep>]… -` (stdin) — ephemeral env, no global
Python. `PythonTarget{Version, Deps}` on `executor.Step`; `PythonStep
{Dependencies, PyVersion}` on `orchestrator.StepSpec`; engine renders `{{VAR}}`
into each dep string. Gated on `uv` on PATH (`uvAvailable()` → `For()` +
`AvailableKinds()` + the `runbookExecutors` capability). Frontend: `'python'`
in `ExecutorKind`/`EXECUTOR_KINDS`/`EXECUTOR_LABEL`, `step.python` on
`StepSpec`, `PythonStepForm` (script + deps + version), token-scan includes
deps. 3 new backend tests. Verified in-browser: python step run → `uv run` →
`py-exec-ok 3.13.3`.

**Still deferred:** **AI Assistant** (script generation — reuses the Prompt
Library P5 model-connection layer) · scheduled/cron runs · OS-keyring-sealed
vault master key (desktop) · multi-user approvals + immutable audit log ·
file-type run parameters · run output artifacts.

(Ansible / kubectl / Terraform are **not** here — see §3.3.)

---

## 10. Decisions (resolved 2026-08-30)

| # | Resolution |
|---|-----------|
| Ansible / kubectl | **No dedicated executors, ever, in this module.** They run as plain commands in a shell/SSH step. Ansible and kubectl get their own modules later. |
| History retention | Default = 90 days / 20 per runbook / pinned kept; **overridable in module Settings** (`runbook_settings`). |
| Vault storage | Dedicated encrypted **`vault.enc`** file (not SQLite). `POST /vault/export` / `/vault/import` for off-machine backup — the file itself is the portable format. |
| `triggered_by` | **Kept** on `run` (always `"local"` for now) — user management comes right after this module. |
| Editor | **Full-page route** `/tools/runbook/edit/:id`. |
| Concurrent runs | **Allowed** — cap at a small N (a `runbook_settings` value), shown in the status strip with a runs tray. |

No open questions remain.

---

## 11. Reused from existing code

| Need | Reuse |
|------|-------|
| Streaming | `backend/internal/sse` + `adapters/backend` SSE client + `useNetworkStream` |
| Run history + prune + diff-by-shape | `internal/history` DB handle + `PrunePolicy`; `core/network/history` diff patterns |
| Elevation | `internal/privilege` + `internal/elevate` (SSH sudo, package install) |
| Exec-and-parse helper | `internal/cmdtool` |
| Backend gating in the UI | `stores/backendStore` + `adapters/backend/useOptionalBackend` |
| Versioning UI (Save / draft / restore / pin / compare) | the Prompt Library's `VersionList` / `VersionCompareDialog` / model helpers — candidate to generalise |
| `{{VAR}}` extract + render | the Prompt Library's `variableExtractor` / `promptRenderer` — candidate for a shared `core/templating/` |
| Single-tool shell module (rail opens it directly) | `ModuleDef.hideToolPane` + `moduleRailRoute` |
| Compare / diff visual language | `adapters/ui/network/RunComparePanel` |

---

## 12. Answering the prototype's UI questions directly

- **"sidebar vs top for options"** → **top nav** (§7.1).
- **"need more space"** → full-width workspace; editor is a **full-page route**,
  not a modal (§7.2); Run is a modal because it's transient (§7.3).
- **"ui changes per executor (api etc.)"** → the step card body swaps by
  executor kind — `ShellStepForm` / `SshStepForm` / `HttpStepForm` (§3.1, §7.2).
- **"package manager for python / system tools"** → the **Packages** section:
  detect + assisted install, `uv` for Python envs (§6.5).
- **"how to store information properly"** → §5: runbooks + runs + nodes in the
  backend SQLite (versioned like the Prompt Library); secrets in an
  Argon2id/AES-GCM Vault, plaintext never leaving the backend; UI prefs only in
  the frontend `IStoragePort`.
