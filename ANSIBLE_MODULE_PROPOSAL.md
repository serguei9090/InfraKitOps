# Ansible Manager — proposal

Status: **decisions resolved 2026-09-01 — see `ANSIBLE_MODULE_PLAN.md` for the
phased build.** This doc keeps the research + rationale. CLAUDE.md reserved
this: *"Ansible + kubectl get their own modules later."*

## Resolved (2026-09-01)

1. **Own module** `ansible` (T7 console, backend-mandatory, "advanced") —
   *not* a Runbooks section. Reuses Runbooks' backend infra (Vault, SSH-node
   registry, SSE, scheduler, history, U3 approval gate).
2. **Runtime = both tiers, user-selectable.** Module setting *Ansible
   runtime*: **Auto** (system `ansible` if on PATH, else offer the managed
   venv) · **System** (always PATH) · **Managed** (InfraKit's own
   `ansible-core` in a `uv` venv, set up / upgrade from the UI).
   `capabilities.ansible = {system:{found,version}, managed:{found,version},
   uv:{found}}`. **Execution Environments (containers) deferred** — `run.go`
   keeps spawning behind one swappable function so an EE runner slots in later.
3. **Bundled streaming callback plugin** — ~60-line Python data file shipped
   next to the sidecar, loaded via `ANSIBLE_CALLBACK_PLUGINS`; emits one JSON
   event per line (`v2_playbook_on_play_start` / `_task_start` /
   `v2_runner_on_ok|failed|skipped|unreachable` / `v2_playbook_on_stats`).
   **Not** a Python dependency of the Go binary. Falls back to raw stdout
   streaming if it can't load.
4. **Project source:** local folder for v1; **git-repo projects land in AN5.**
5. **Inventory lives as files in the Project** (INI/YAML), edited through a UI
   tree editor — ansible is too file-native to fight (dynamic inventory,
   `group_vars/` dir convention, `ansible-inventory --graph`). Plus one small
   DB-backed "scratch inventory" for ad-hoc runs not tied to a project.
6. **Surveys = FormFlow.** Attach an optional FormFlow schema to a Job;
   on launch render the FormFlow runner, map its values tree → `-e @vars.json`.
   No new form engine.
7. **ansible-vault bridge:** vault password is a normal InfraKit Vault secret,
   fed to `ansible-vault` / `ansible-playbook` via a temp `--vault-password-file`
   (0600, auto-deleted) — same flow as SSH keys. Encrypted files stay in the
   Project folder.
8. **Scope ceiling:** AN0–AN5 = the module. **Workflows deferred** — Runbooks
   already chains steps; later a runbook step runs an Ansible Job (the bridge).
   **Execution Environments deferred** (see 2).
9. **kubectl:** build Ansible standalone; keep `internal/ansible` + the T7
   console clean enough that a future `kubectl` / `terraform` module copies
   the workspace-folder model, the SSE run-tree, the runtime toggle, and
   history replay. No abstract "CLI manager" now.

### Workspace folder model

One **workspace base directory** — an instance setting (admin-set in
multi-user), default `<OS config dir>/InfraKitStudio/ansible/`. On first
module open: a one-time *"Ansible projects folder: [default] [Change…]"* step.

Inside it, **Projects** — each a self-contained ansible directory:
- **New Project** → InfraKit scaffolds `ansible.cfg` · `inventory/` ·
  `group_vars/` · `host_vars/` · `roles/` · `collections/` ·
  `requirements.yml` · a starter playbook.
- **Add existing** → register any absolute path (an existing checkout, a
  shared mount). The Project row stores `path`.
- `ansible-galaxy` installs **project-local** (`roles/` + `collections/`,
  per `requirements.yml` + `ansible.cfg` paths).
- Projects are `owner`-scoped; `published` = shared/runnable by other
  operators.

---

---

## 1. What the existing Ansible UIs do

Surveyed AWX / Ansible Automation Platform, Semaphore UI, ansible-navigator
(TUI), ARA, and the `ansible-runner` library the first two are built on.

| Tool | Shape | Takeaway for us |
|------|-------|----------------|
| **AWX / AAP** | Django + Postgres + Redis + receptor + k8s. Projects · Inventories · Credentials · **Job Templates** · **Surveys** (prompt-on-launch form → extra_vars) · **Workflows** (chained jobs) · live task/host output tree · schedules · RBAC · Execution Environments. | The feature *vocabulary* everyone copies. Red Hat itself says the architecture "limits the ability to innovate" — **don't clone the stack, clone the model.** |
| **Semaphore UI** | One Go binary, ~50 MB RAM. Key Store (encrypted SSH keys / passwords / tokens) · Inventory (static in-DB or dynamic) · **Environment** (reusable extra-vars + env JSON) · **Task Templates** (playbook + inventory + environment + git repo → re-runnable) · schedules · run history · RBAC. Also runs Terraform / OpenTofu / PowerShell. | **Closest fit to InfraKit's philosophy** — light, single-binary, a clean focused UI over a handful of concepts. Our backend is already a Go binary with an encrypted vault + a run engine. |
| **ansible-navigator** | Terminal TUI over `ansible-runner`. `:inventory` · `:config` · `:doc <module>` · `:collections` · `:run playbook.yml` · saves a JSON **artifact** per run, `:replay` to review. | The *run + inspect + replay* loop, and the `ansible-runner` event model, are the right execution primitive. |
| **ARA** | A **callback plugin** streams every play/task/host event to an API → DB → read-only web UI for browsing past runs. | Proves the "custom callback → structured event stream" approach we'd use to get a live task tree without scraping stdout. |
| **`ansible-runner`** | Python library: spawns `ansible-playbook`, emits structured JSON events (`playbook_on_play_start`, `runner_on_ok`, `runner_on_failed`, `playbook_on_stats`, …), stores artifacts, optionally runs inside a container Execution Environment. | AWX + Navigator + AAP all sit on this. It's Python — **can't** be a dep of our one-binary Go sidecar. We replicate its event model with a small bundled callback plugin instead. |

**Common building blocks every one of them has:**

1. **Inventory** — hosts + groups + group_vars/host_vars, static or dynamic.
2. **Credentials** — SSH keys, become passwords, vault passwords — encrypted.
3. **Playbook source** — a git repo or a local project directory.
4. **Run config** — playbook + inventory + `--limit` + `--tags`/`--skip-tags`
   + `-e extra_vars` + `--check`/`--diff`/`-v…` + `--become`.
5. **Streaming output** — play → task → host tree, per-host
   OK/CHANGED/FAILED/SKIPPED/UNREACHABLE, a final recap.
6. **Ad-hoc** — `ansible <pattern> -m <module> -a "<args>"`.
7. **Galaxy** — `ansible-galaxy install -r requirements.yml` (roles +
   collections), version pins.
8. **ansible-vault** — encrypt / decrypt / view / edit a vars file.
9. **Run history / artifacts** — every run recorded and re-openable.
10. **Schedules** — cron.
11. **Authoring** — a YAML editor with `--syntax-check`, `ansible-lint`,
    `ansible-doc <module>` lookup.
12. **Facts** — `ansible -m setup`, a per-host fact cache.

---

## 2. How much of this InfraKit already has

The **Runbooks module** built almost all of the plumbing:

| Need | Already in the repo |
|------|---------------------|
| Spawn a process, stream it over SSE | `internal/orchestrator` + `internal/executor` + `internal/sse` |
| Encrypted secret store (SSH keys, passwords, tokens) | `internal/vault` (Argon2id → AES-GCM, per-user registry after U2) |
| Remote host registry (host + port + user + auth secret + host-key pin) | `ssh_node` table + `SshNodesView` |
| Run history with artifacts, secret redaction, destructive-pattern scan | `run` table + `Redact` + `ScanDestructive` |
| Cron scheduler | `orchestrator/{cron,scheduler}.go` |
| Python-via-`uv` executor (managed venv) | `executor/python.go` — **could `uv pip install ansible-core` into a managed venv** |
| T7 "Console Workspace" UI scaffold (own top nav, not a sidebar) | `adapters/ui/runbook/RunbookConsoleScaffold.tsx` |
| Multi-user: owner scoping, per-user vaults, module ACL, **approval gate** | U0–U6 (just shipped) |
| "Generate / explain" AI panel | `adapters/ui/ai/AiPanel.tsx` + a grounding `Task` |
| **Dynamic form designer** (fields, types, validation, array loops) | **FormFlow** — `core/form_flow/**` — this is exactly an AWX **Survey** engine |

So the Ansible module is mostly: an `internal/ansible` package that knows how
to *invoke ansible correctly and parse its events*, plus a T7 console UI, plus
a few new data models (project, inventory, job). It **reuses** the vault, the
SSH-node registry (as an inventory source), the SSE plumbing, the scheduler,
the history patterns, FormFlow (surveys), and `<AiPanel>`.

---

## 3. Recommended shape

**A new backend-mandatory module `ansible` (own rail entry, T7 console), a new
`internal/ansible` Go package, reusing the Runbooks infrastructure.** Modelled
on **Semaphore's concept set** (light, few nouns) with **AWX's survey +
approval** ideas layered on via FormFlow + the U3 approval gate.

### 3.1 How we run ansible — three tiers, cheapest first

Matches the network-module doctrine (§"How to implement a network tool").

1. **User's own `ansible` on PATH (v1 default).** The module detects
   `ansible`, `ansible-playbook`, `ansible-galaxy`, `ansible-vault`,
   `ansible-lint`, `ansible-doc` and their versions. Runs are
   `ansible-playbook <opts>` with **a small bundled callback plugin**
   (`ANSIBLE_CALLBACK_PLUGINS` + `ANSIBLE_LOAD_CALLBACK_PLUGINS=1`,
   `CALLBACK_TYPE='notification'`, `CALLBACK_NEEDS_ENABLED`) that writes one
   JSON line per event (`v2_playbook_on_play_start`,
   `v2_playbook_on_task_start`, `v2_runner_on_ok/failed/skipped/unreachable`,
   `v2_playbook_on_stats`) to a fd the Go backend reads → SSE. This is how ARA
   / AWX get a live play/task/host tree without scraping stdout. **~60 lines
   of Python, bundled as a data file — not a Python dependency of the Go
   binary.**
2. **Managed venv via the existing `uv` executor.** If ansible isn't on PATH,
   offer a one-click "Install ansible-core into a managed venv"
   (`uv venv` + `uv pip install ansible-core`, gated on `uv` on PATH like the
   Python executor already is). The module then uses that venv's binaries.
3. **Execution Environments (Podman/Docker container images).** AWX-style.
   **Deferred** — a much bigger surface, optional.

Hand-rolled anything (linking libansible, embedding Python) — never.

### 3.2 Data models (new, framework-free `core/ansible/**` + `internal/ansible`)

- **Project** — a local directory *or* a git URL the backend clones (Runbooks
  already shells `git` for library sync). Playbooks are auto-discovered
  (`*.yml` with a top-level list of plays); `roles/`, `collections/`,
  `requirements.yml`, `ansible.cfg`, `inventory/` detected. Owner-scoped.
- **Inventory** — static (groups → hosts, group_vars, host_vars; stored as
  YAML/INI in-DB or a file in the project) with **"import from SSH Nodes"**;
  or dynamic (a script / inventory plugin the backend executes). Owner-scoped.
- **Credential set** — references InfraKit Vault secrets: a machine SSH
  key/password, a `--become` password, an `ansible-vault` password. No
  plaintext.
- **Job** (= AWX "Job Template" / Semaphore "Task Template") — project +
  playbook + inventory + credential set + `limit` + `tags`/`skipTags` +
  `extraVars` (YAML) + `check`/`diff`/`verbosity` + `become` + `forks`.
  Saved, re-runnable, schedulable, **publishable** (shared), optionally
  `requiresApproval` (reuses U3). May attach a **Survey** — a FormFlow schema
  whose answers become `extra_vars` on launch.
- **Run** — one execution: the job snapshot + the streamed event tree +
  per-host recap + the raw artifact (JSON events + stdout). Owner = the
  runner. Re-openable from History.

### 3.3 Backend — `internal/ansible/`

- `detect.go` — find the binaries + versions, report capabilities
  (`capabilities.ansible = {ansible, playbook, galaxy, vault, lint, doc,
  version, venvManaged}`).
- `callback/infrakit_events.py` — the bundled streaming callback (data file).
- `run.go` — build the argv, set env (`ANSIBLE_*`, callback path, vault
  password file from a temp fifo, SSH key from a temp file 0600 auto-deleted),
  spawn, parse the event stream, emit SSE, persist the artifact + recap,
  redact secrets everywhere (reuse `Redact`).
- `adhoc.go` — `ansible <pattern> -m <mod> -a <args>` same event path.
- `galaxy.go` — `ansible-galaxy role/collection install -r requirements.yml`
  (+ search the galaxy.ansible.com API), streamed.
- `vault.go` — `ansible-vault encrypt/decrypt/view/edit` with a password from
  the InfraKit Vault.
- `lint.go` / `doc.go` — `ansible-lint --parseable`, `ansible-doc -j <module>`.
- `store.go` — projects / inventories / jobs / runs, owner-scoped (mirrors the
  U3 orchestrator store).
- `/api/v1/ansible/*` — projects, inventories, jobs, `jobs/{id}/run/stream`
  (SSE), `adhoc/stream`, `galaxy/*`, `vault/*`, `doc`, `runs`, schedules.
- `capabilities.ansible` gate; module 503s cleanly when ansible is absent and
  the UI shows an "install ansible-core / point at a venv" state.

### 3.4 Frontend — T7 console (`adapters/ui/ansible/`)

Rail module `ansible` (`hideToolPane`, `moduleRailRoute`). Console top-nav
sections:

| Section | What |
|---------|------|
| **Projects** | add a local dir / git URL, browse discovered playbooks + roles + collections, edit `ansible.cfg` |
| **Inventory** | group/host tree editor, group_vars/host_vars, import from SSH Nodes, test a dynamic inventory |
| **Jobs** | the saved run configs (playbook + inventory + opts + survey). "Run" → the launch prompt (survey form if attached) → the live run |
| **Run view** | play → task → host tree, live via SSE, per-host OK/CHANGED/FAILED/SKIPPED/UNREACHABLE badges, final recap, Stop, re-run |
| **Ad-hoc** | pattern + module (with `ansible-doc` autocomplete) + args + inventory → streamed |
| **Content** | `requirements.yml` editor, search Ansible Galaxy, install / list roles + collections |
| **Editor** | Monaco/CodeMirror YAML playbook editor — `--syntax-check`, `ansible-lint`, `ansible-doc` sidebar, **AI generate / explain** via `<AiPanel>` |
| **Vault** | ansible-vault encrypt/decrypt/view/edit a vars file (password from InfraKit Vault) |
| **History** | every run, re-openable (artifact replay) |
| **Schedules** | cron a Job |

### 3.5 Multi-user (free, from U0–U6)

Projects / inventories / jobs / runs are `owner`-scoped; a Job can be
**published** (shared, runnable by other operators) or stay a private draft;
a Job flagged `requiresApproval` parks for a second operator (the U3 gate,
verbatim). ansible-vault passwords live in each user's InfraKit vault. Module
visible only if `allowedModules` permits.

---

## 4. Phasing (rough — becomes the plan)

| Phase | Scope | Milestone |
|-------|-------|-----------|
| **AN0** | `internal/ansible` detect + bundled callback + `run.go` event stream + T7 scaffold + Projects (local dir) + **run a playbook end-to-end** with the live task/host tree | "I can run a playbook and watch it." |
| **AN1** | Inventory (static groups/hosts/vars + import from SSH Nodes) · Jobs (saved run configs) · Run history + artifact replay | Reusable, recorded runs. |
| **AN2** | Ad-hoc pane · `ansible-doc` lookup · playbook YAML editor + `--syntax-check` + `ansible-lint` | Authoring + one-offs. |
| **AN3** | Content: `requirements.yml`, Galaxy search + install roles/collections | Dependency management. |
| **AN4** | ansible-vault helpers · **Surveys** (FormFlow prompt-on-launch → extra_vars) · Schedules (cron a Job) | Parameterised + scheduled. |
| **AN5** | Git-repo Projects · dynamic inventory · multi-user scoping + publish + approval gate · managed-venv install flow | Team-ready. |
| **AN6** *(deferred)* | Execution Environments (Podman) · Workflows (chain Jobs, success/fail branches) · fact cache browser | AWX-parity extras. |

**AN0–AN1 = a usable module.** AN2–AN4 make it comfortable. AN5 makes it
multi-user. AN6 is optional AWX-parity.

---

## 5. Decisions needed

1. **Own module** (rail id `ansible`, T7 console) vs a section inside
   **Runbooks**? Recommend **own module** (CLAUDE.md already reserved it; the
   concept set is large) that *shares* the Runbooks backend infra.
2. **Execution tier:** confirm **Tier 1** (user's `ansible` on PATH) + **Tier
   2** (offer a managed `uv` venv) for v1; **Execution Environments deferred**.
   Or do you want EE/containers as a first-class v1 concern?
3. **Bundled callback plugin** (~60 lines of Python, shipped as a data file —
   *not* a Python dependency of the Go binary) to get the live task/host tree
   — OK? The alternative is scraping the default stdout callback (fragile,
   loses structure).
4. **Playbook source:** local directory only for v1, or git-repo Projects from
   the start? (git adds clone/pull/branch/creds — recommend local first,
   git in AN5.)
5. **Inventory storage:** in the InfraKit DB (owner-scoped rows), or as files
   inside the Project directory (more "native", diffable, but less
   multi-user-friendly)? Recommend **DB rows** with an "export to file" option.
6. **Surveys via FormFlow** — reuse the FormFlow schema/designer for
   prompt-on-launch forms? (Big win — no new form engine.) Or a simpler
   key/type/default list like AWX's native survey?
7. **`ansible-vault` bridge** — store the vault password as a normal InfraKit
   Vault secret and feed it to `ansible-vault` via a temp file? (Recommended —
   consistent with how SSH keys already flow.)
8. **Scope ceiling for v1** — is AN6 (Execution Environments, Workflows) ever
   wanted, or is "run playbooks + inventory + jobs + galaxy + vault + surveys"
   the whole ambition?
9. **kubectl** — CLAUDE.md pairs "Ansible + kubectl" as future modules. Build
   Ansible standalone now, or design `internal/ansible` + the T7 console
   generic enough that a `kubectl` module reuses the shell?

---

## 6. New dependencies

- **Backend:** none new for Tier 1 — `ansible` is the user's own binary,
  invoked like `nft`/`git`/`iperf3` already are. The callback plugin is a
  bundled text file. Tier 2 reuses the existing `uv` integration.
- **Frontend:** a YAML code editor. CodeMirror 6 (`@codemirror/*`, small,
  tree-shakeable) or Monaco (heavier). Prompt Library / Runbooks already have
  plain `<textarea>` editors — a real editor is the one genuine FE add.
- **Execution Environments (AN6, deferred):** would need Podman/Docker present
  — never bundled, PATH-detected.

---

Sources:
[AWX vs Semaphore (2026)](https://semaphoreui.com/blog/awx-vs-semaphore) ·
[AWX alternatives](https://kestra.io/resources/infrastructure/awx-alternatives) ·
[Semaphore vs AWX vs Rundeck](https://www.pistack.xyz/posts/semaphore-vs-awx-vs-rundeck-self-hosted-ansible-ui-guide-2026/) ·
[Semaphore Ansible docs](https://semaphoreui.com/docs/user-guide/apps/ansible) ·
[Semaphore inventory](https://deepwiki.com/semaphoreui/semaphore-docs/6.2-inventory-management) ·
[ansible-navigator (GitHub)](https://github.com/ansible/ansible-navigator) ·
[ansible-navigator deep dive](https://tenthirtyam.org/dispatches/2026/05/30/ansible-navigator-a-practical-deep-dive/) ·
[ARA Records Ansible](https://pypi.org/project/ara/1.0.0.0a3) ·
[Galaxy requirements.yml](https://docs.ansible.com/projects/ansible/latest/galaxy/user_guide.html) ·
[AWX Job Templates](https://docs.ansible.com/projects/awx/en/24.6.1/userguide/job_templates.html) ·
[AWX surveys](https://yallalabs.com/devops/how-to-use-survey-provide-variables-awx-ansible-tower/) ·
[Ansible callback plugins](https://www.ansiblepilot.com/articles/ansible-callback-plugins-customize-output-notifications-guide)
