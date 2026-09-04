# Ansible Manager module (AN)

Status: **approved design 2026-09-01, not started.** All 9 open questions from
[`ANSIBLE_MODULE_PROPOSAL.md`](ANSIBLE_MODULE_PROPOSAL.md) are resolved (see its
"Resolved" block). Big module, backend-first; **reuses the Runbooks module's
infrastructure** rather than re-building it.

---

## 1. Why + scope

A dedicated, advanced Ansible workbench inside InfraKit Studio: manage
inventory, author + run playbooks, run ad-hoc modules, install Galaxy roles /
collections, bridge `ansible-vault` to the InfraKit Vault, record every run
with a live play → task → host tree, schedule jobs, and (multi-user) share
jobs + gate risky ones behind a second operator.

Modelled on **Semaphore UI's** concept set (light, few nouns) with **AWX's**
survey (prompt-on-launch) and approval ideas layered on via **FormFlow** + the
**U3 approval gate**.

**In scope (AN0–AN5):** runtime detection (system / managed venv), projects
(local folder), inventory (project files), jobs (saved run configs), run
engine + streaming tree + history/replay, ad-hoc, Galaxy content, `ansible-vault`
helpers, playbook editor (`--syntax-check` / `ansible-lint` / `ansible-doc` /
AI), surveys, schedules, git-repo projects, dynamic inventory, multi-user.

**Deferred:** Execution Environments (containers), Workflows (Runbooks already
chains steps — a later "runbook step → Ansible Job" is the bridge), a fact-cache
browser.

---

## 2. Decisions (resolved — full rationale in the proposal)

| # | Decision |
|---|----------|
| Placement | **Own module** `ansible` — T7 console, backend-mandatory, "advanced". Not a Runbooks section. |
| Runtime | **Both tiers, user-selectable** — module setting *Ansible runtime*: **Auto** / **System** (PATH `ansible`) / **Managed** (InfraKit `ansible-core` in a `uv` venv). Execution Environments deferred. |
| Events | **Bundled streaming callback plugin** (~60 lines Python, a data file — not a Go dep), loaded via `ANSIBLE_CALLBACK_PLUGINS`. Fallback to raw stdout. |
| Project source | **Local folder for v1**, git-repo projects in **AN5**. |
| Inventory | **Files in the Project** (INI/YAML), UI tree editor. One DB "scratch inventory" for ad-hoc. |
| Surveys | **FormFlow** — attach a schema to a Job → answers map to `-e @vars.json`. |
| ansible-vault | Vault password is an InfraKit Vault secret → temp `--vault-password-file` (0600, auto-deleted). Encrypted files stay in the Project. |
| Workspace | One base dir (instance setting, default `<config>/InfraKitStudio/ansible/`); one-time "pick folder" on first open; Projects are owner-scoped subdirs / registered paths. |

---

## 3. Architecture

### 3.1 Backend — `internal/ansible/`

New Go package. **No new Go dependency** — `ansible*` binaries are the user's
own (or the managed venv's), invoked like `git` / `nft` / `iperf3` already are.

| File | Job |
|------|-----|
| `runtime.go` | Resolve the active runtime (Auto/System/Managed) → the dir holding `ansible`, `ansible-playbook`, `ansible-galaxy`, `ansible-vault`, `ansible-lint`, `ansible-doc`; report versions. `EnsureManaged()` = `uv venv <config>/ansible-venv` + `uv pip install ansible-core[==ver]` (streamed). |
| `callback/infrakit_events.py` | The bundled streaming callback (data file; `CALLBACK_VERSION=2.0`, `CALLBACK_TYPE='notification'`, `CALLBACK_NEEDS_ENABLED=True`, `CALLBACK_NAME='infrakit_events'`). Writes one JSON line per event to the fd in `$INFRAKIT_EVENT_FD` (or a file). |
| `run.go` | `Run(ctx, spec, out)` — build argv, set env (`ANSIBLE_CALLBACK_PLUGINS`, `ANSIBLE_LOAD_CALLBACK_PLUGINS=1`, `ANSIBLE_STDOUT_CALLBACK`, `ANSIBLE_HOST_KEY_CHECKING`, temp key + vault-pw files), spawn `ansible-playbook`, fan the event stream + raw stdout to SSE, persist the artifact + recap, `Redact` secrets everywhere. **One spawn function** so an EE runner can replace it later. |
| `adhoc.go` | `ansible <pattern> -m <module> -a <args> -i <inv>` — same event path. |
| `galaxy.go` | `ansible-galaxy {role,collection} install -r requirements.yml -p <project>` (streamed) + search the `galaxy.ansible.com` v3 API. |
| `vault.go` | `ansible-vault {encrypt,decrypt,view,edit,rekey}` with a password from the Vault. |
| `lint.go` / `doc.go` / `syntax.go` | `ansible-lint -f json`, `ansible-doc -j <module>`, `ansible-playbook --syntax-check`. |
| `project.go` | Scaffold a new project dir; discover playbooks (`*.yml` whose top level is a list of plays), `roles/`, `collections/`, `requirements.yml`, `ansible.cfg`, `inventory/`. Register an existing path. |
| `inventory.go` | Read/write group/host/vars files; `ansible-inventory --list/--graph -i <inv>` to validate + graph; run a dynamic inventory script/plugin. |
| `store.go` | `ansible.db` (sibling of `orchestrator.db`) — projects / jobs / runs / schedules / scratch-inventory, `owner`-scoped (mirrors the U3 orchestrator store: `owner` column, `scopeOwner`, `ClaimOrphans`). Workspace dir + runtime choice in `ansible_settings`. |

### 3.2 Runtime resolution

```
runtime = setting "ansibleRuntime"  (auto | system | managed)

auto     → system if `ansible-playbook` on PATH, else managed if it exists,
           else "not set up" (UI offers EnsureManaged)
system   → PATH; capability false + reason if missing
managed  → <config>/ansible-venv/bin (or Scripts on Windows); UI has
           "Set up" / "Upgrade" / "Reinstall" buttons (uv, streamed)
```

`capabilities.ansible = { runtime, system:{found,version,path},
managed:{found,version}, uv:{found}, lint:{found}, doc:{found} }`. Module 503s
cleanly with a "choose a runtime" state when nothing resolves.

### 3.3 Event model (the live tree)

The callback emits, one JSON object per line:

```jsonc
{"e":"play_start","play":"webservers","hosts":["web1","web2"]}
{"e":"task_start","play":"webservers","task":"install nginx","action":"ansible.builtin.package"}
{"e":"runner_ok","task":"install nginx","host":"web1","changed":true,"result":{...}}
{"e":"runner_failed","task":"...","host":"web2","result":{"msg":"..."}}
{"e":"runner_skipped","task":"...","host":"web1"}
{"e":"runner_unreachable","host":"web3","result":{"msg":"ssh: connect..."}}
{"e":"stats","hosts":{"web1":{"ok":5,"changed":2,"failures":0,"unreachable":0,"skipped":1}}}
```

`run.go` reforms this into SSE events the frontend renders as a
**play → task → host** tree with per-host badges. Raw stdout also streams
(a "Console" toggle) for anything the structured path misses. Fallback mode
(callback failed to load) = stdout only, no tree.

The whole event log + the final recap + argv (redacted) are saved as the
**run artifact** → History replay re-renders the tree offline.

### 3.4 Data models (framework-free `core/ansible/**`)

- **Project** `{id, owner, name, path, source: "local"|"git", git?: {url,ref},
  published, createdAt}` — `path` is absolute; discovered content is read live,
  not stored.
- **Job** `{id, owner, projectId, playbook, inventory, credentialSetId?,
  limit?, tags?, skipTags?, extraVars?(yaml), check?, diff?, verbosity?,
  become?, forks?, surveySchema?(FormFlow), published, requiresApproval,
  createdAt}` — the AWX "Job Template" / Semaphore "Task Template".
- **CredentialSet** `{id, owner, name, sshSecretId?, becomeSecretId?,
  vaultSecretId?}` — all references into the InfraKit Vault.
- **Run** `{id, owner, jobId?, adhoc?, status, startedAt, finishedAt, argv,
  events(blob), recap, triggeredBy}` — status incl. `awaiting_approval`
  (U3 gate).
- **ScratchInventory** `{id, owner, name, content}` — a plain host list for
  ad-hoc runs with no project.

### 3.5 API — `/api/v1/ansible/*`

| Method | Route | |
|--------|-------|--|
| GET | `/ansible/settings` · PUT (admin) | workspace dir, runtime |
| POST | `/ansible/runtime/setup/stream` (SSE) | EnsureManaged / upgrade |
| GET/POST/DELETE | `/ansible/projects[/{id}]` | + `POST /projects/{id}/scaffold`, `GET /projects/{id}/tree` |
| GET/PUT | `/ansible/projects/{id}/file?path=` | read/write a project file (inventory, playbook, ansible.cfg) — path-jailed to the project |
| GET/POST/PUT/DELETE | `/ansible/jobs[/{id}]` | |
| GET | `/ansible/jobs/{id}/run/stream` (SSE) | + `?args=` for survey answers |
| POST | `/ansible/jobs/{id}/publish` · `/runs/{id}/approve` | reuse U3 shapes |
| GET | `/ansible/adhoc/stream` (SSE) | `?pattern=&module=&args=&inventory=` |
| GET/POST | `/ansible/galaxy/search` · `/ansible/galaxy/install/stream` (SSE) | |
| POST | `/ansible/vault/{op}` | encrypt/decrypt/view/edit/rekey |
| GET | `/ansible/doc?module=` · `POST /ansible/lint` · `/ansible/syntax-check` | |
| GET | `/ansible/runs[/{id}]` · `/ansible/runs/pending-approvals` | |
| GET/POST/PUT/DELETE | `/ansible/schedules[/{id}]` | via `orchestrator/scheduler` |

All `apierr`-coded, `owner(r)`-scoped, guarded (503 when the store / runtime
isn't ready).

### 3.6 Frontend — `adapters/ui/ansible/` (T7 console)

Rail module `ansible` (`hideToolPane`, `moduleRailRoute`), backend-mandatory.
`AnsibleConsoleScaffold` — own top nav. **First open:** if
`ansible_settings.workspaceDir` unset → a setup card ("Ansible projects
folder"); if no runtime → a runtime card.

| Section | Screen |
|---------|--------|
| **Projects** | list; New / Add existing; a file tree (playbooks, `roles/`, `collections/`, `ansible.cfg`); per-project runtime + galaxy status |
| **Inventory** | group→host tree editor over the project's inventory files; group_vars / host_vars panels; **Import from SSH Nodes**; `--graph` preview; test a dynamic script |
| **Jobs** | saved run configs; a Job form (playbook picker, inventory picker, limit/tags/check/diff/verbosity/become, extra-vars YAML, attach a Survey); Run → launch prompt (FormFlow survey if attached) |
| **Run view** | play → task → host tree (SSE), per-host OK/CHANGED/FAILED/SKIPPED/UNREACHABLE, recap, Console toggle, Stop, re-run |
| **Ad-hoc** | pattern + module (`ansible-doc` autocomplete) + args + inventory → streamed |
| **Content** | `requirements.yml` editor; Galaxy search; install / list roles + collections (project-local) |
| **Editor** | CodeMirror 6 YAML playbook editor — `--syntax-check`, `ansible-lint` panel, `ansible-doc` sidebar, **AI** generate/explain via `<AiPanel>` (new grounding tasks `ansible.gen-playbook`, `ansible.explain-task`) |
| **Vault** | pick a file → encrypt / decrypt / view / edit / rekey (password from InfraKit Vault) |
| **History** | every run, re-openable (artifact replay) |
| **Schedules** | cron a Job |
| **Runtime** (in Settings → a new "Ansible" section) | Auto/System/Managed, workspace dir, Set up / Upgrade managed venv |

Stores: `ansibleStore` (projects/jobs/runs/live), `ansibleRuntimeStore`.
Clients: `ansibleClient.ts`. Core: `core/ansible/**` (framework-free models +
the FormFlow-survey → extra_vars mapper).

### 3.7 Multi-user (free from U0–U6)

Projects / jobs / runs / schedules / scratch-inventory are `owner`-scoped;
a Job is a private draft until **published** (then runnable by other
operators); `requiresApproval` parks a run for a second operator (U3 gate,
verbatim — reuse `Engine.awaitRunApproval` shape). Vault passwords per user.
Module visible only if `allowedModules` permits. Workspace dir + runtime are
instance settings (admin).

### 3.8 Security

- SSH keys + vault + become passwords → temp files `0600`, `defer os.Remove`,
  never argv, never logged; `Redact` over every event + the artifact.
- `projects/{id}/file` path-jailed to the Project dir (`filepath.Clean` +
  prefix check) — no `../` escape.
- The bundled callback is a fixed file we ship; `ANSIBLE_CALLBACK_PLUGINS`
  points only at its dir.
- `--check`/`--diff` and a **destructive-pattern scan** (reuse Runbooks'
  `ScanDestructive` on the rendered playbook / ad-hoc args) surface risky runs
  before launch.
- `ANSIBLE_HOST_KEY_CHECKING` default **on**; unknown-host prompts become a
  confirm in the run view (like the SSH executor's host-key pinning).
- Managed venv install pins `ansible-core` and records the version.

---

## 4. Phases

Each is a green checkpoint; commit per checkpoint bullet.

| Phase | Scope | Milestone |
|-------|-------|-----------|
| **AN0** | `internal/ansible` `runtime.go` (Auto/System/Managed + `EnsureManaged` via uv) · `callback/infrakit_events.py` · `run.go` event stream + SSE + artifact · `store.go` (projects/runs, owner-scoped) · workspace-dir setting · T7 scaffold + first-open cards · **Projects** (local folder, scaffold / add existing, file tree) · **Run view** (play→task→host tree) · run a discovered playbook end-to-end. `capabilities.ansible`. | "Pick a folder, run a playbook, watch the tree." |
| **AN1** | **Inventory** (group/host/vars file editor, `--graph`, Import from SSH Nodes) · **Jobs** (saved run configs) · **History** + artifact replay · Stop / re-run | Reusable, recorded runs. |
| **AN2** | **Ad-hoc** pane · `ansible-doc` lookup + autocomplete · **Editor** (CodeMirror YAML, `--syntax-check`, `ansible-lint`) | Authoring + one-offs. |
| **AN3** | **Content** — `requirements.yml` editor, Galaxy search, install/list roles + collections (project-local) | Dependency management. |
| **AN4** | **ansible-vault** helpers · **Surveys** (FormFlow → `-e @vars.json`) · **Schedules** (cron a Job via `orchestrator/scheduler`) · AI tasks (`ansible.gen-playbook`, `ansible.explain-task`) in the Editor | Parameterised + scheduled + AI. |
| **AN5** | **git-repo Projects** (clone/pull/ref, creds via Vault) · **dynamic inventory** (script/plugin) · multi-user: publish + approval gate + per-user vault passwords · dynamic-inventory test | Team-ready. |
| **AN6** *(planned — own doc)* | Pluggable execution backends — a `Runner` interface with `Local` / `Container` (docker·podman) / `WSL` / `SSH-remote` implementations, chosen at first-open + in Settings. Makes the module usable from a **Windows** host. + fact-cache browser. Workflows **killed**. Full design + AN6a–AN6f order: [`ANSIBLE_RUNTIME_PLAN.md`](ANSIBLE_RUNTIME_PLAN.md). | Run playbooks from Windows. |

**AN0–AN1 = a usable module.** AN2–AN4 make it comfortable. AN5 = multi-user.
**AN6 = runs anywhere** (Windows via Docker/WSL, or a remote Linux control node).

---

## 5. Dependencies

- **Backend:** **none new.** `ansible*` = the user's binaries (or the managed
  venv's), spawned like `git`/`nft`/`iperf3`. `uv` (already integrated for the
  Runbooks Python executor) drives the managed venv. The callback plugin is a
  bundled text file.
- **Frontend:** **CodeMirror 6** (`@codemirror/state`, `@codemirror/view`,
  `@codemirror/lang-yaml`, `@codemirror/commands`) — small, tree-shakeable,
  the one genuine add. Used for the playbook + inventory + `requirements.yml`
  editors; Prompt Library / Runbooks can adopt it later.
- **AN6 execution backends:** `docker` / `podman` / `wsl.exe` / `ssh` invoked
  like `git` — none bundled, all detected with an install link. Optional pinned
  WSL rootfs is a fetched+SHA-verified data file. See
  [`ANSIBLE_RUNTIME_PLAN.md`](ANSIBLE_RUNTIME_PLAN.md).

Related: [[runbook-module-plan]] (infra reuse — vault, SSH nodes, SSE,
scheduler, history, approval gate), [[user-management-plan]] (owner scoping,
per-user vaults, module ACL, U3 approval), FormFlow (surveys),
[[ai-module-plan]] (`<AiPanel>` generate/explain).
