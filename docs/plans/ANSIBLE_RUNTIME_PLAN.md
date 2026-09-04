# Ansible Manager — AN6: pluggable execution backends

Status: **AN6 COMPLETE** (`e889f5e`, `d1dbafd`, `a08d1dd`, `ae20044`,
`5b9cfa2`) — the module runs from Windows via a container or a WSL2 distro, or
on a remote Linux host over SSH, with one shared control-node dependency list
and a fact-cache browser.

**Runner interface** (final): `Stream(ctx, RunReq, onOut, onErr)` +
`Capture(ctx, RunReq) []byte` — not `*exec.Cmd`, so the ssh runner can own
execution. local/container/wsl share `streamVia`/`captureVia` over a private
`buildCmd`. Supersedes the one-line "AN6 (deferred)" in
[`ANSIBLE_MODULE_PLAN.md`](ANSIBLE_MODULE_PLAN.md) §4. Prereq: AN0–AN5 done
(`1919de0`…`a65bd61`).

**Implementation note:** the `Runner` types live in `package ansible`
(`runner.go`, `runner_container.go`), not a `runner/` sub-package — avoids a
`RuntimeMode` import cycle. `Engine.activeRunner(ctx)` picks by the
`ansibleRuntime` setting; `Engine.SetupRuntime` / `Runners` / `TeardownRuntime`
are the exported entry points.

## 1. Why

Ansible's **control node** does not run on native Windows — `ansible-core ≥ 2.17`
hard-fails at startup (`check_blocking_io()` → `os.get_blocking(fd)` →
`OSError [WinError 87]`), and it depends on POSIX-only primitives (`fork`,
non-blocking pipes, `pwd`/`grp`, the fork-based worker pool). Installing Python
does **not** fix this. Windows is fully supported as a *managed node* (target),
never as the control side.

So AN0–AN5 work end-to-end only where the backend runs on Linux/macOS. AN6 makes
the module usable **from a Windows host** (and cleaner everywhere) by turning the
single "spawn `ansible-playbook`" point into a **`Runner` interface** with several
implementations, chosen at first-open and switchable in Settings.

`run.go` already anticipated this — "**One spawn function** so an EE runner can
replace it later" (`ANSIBLE_MODULE_PLAN.md` §3.1).

**Not in scope / killed:** AWX-style **Workflows** (job-level DAG). Ordered
`roles:` in a play + `block/rescue` cover the single-operator case; Workflows are
for multi-team, separately-schedulable stages. Dropped from AN6.

## 2. The `Runner` interface

```go
// internal/ansible/runner/runner.go   (new sub-package)
type Runner interface {
    // Name is the RuntimeMode value ("system", "container", "wsl", "remote").
    Name() RuntimeMode
    // Probe reports whether this runner can execute right now, plus detail
    // for the Settings UI (versions, distro list, daemon state, reason).
    Probe(ctx context.Context) RunnerStatus
    // Exec runs one ansible* command. It is handed the already-built argv,
    // the project dir, the env (callback vars + INFRAKIT_EVENT_FILE), and
    // stdout/stderr line sinks; it must make the event file readable by the
    // caller (mount / share / copy-back) and block until the process exits.
    Exec(ctx context.Context, spec ExecSpec) error
    // Setup provisions the runner (build image / import distro / pip install),
    // streaming progress lines. No-op for "system".
    Setup(ctx context.Context, opts SetupOpts, emit func(string)) error
    // Teardown removes what Setup created (rmi / wsl --unregister / rm venv).
    Teardown(ctx context.Context) error
}

type ExecSpec struct {
    Tool       string   // "ansible-playbook" | "ansible" | "ansible-galaxy" | …
    Argv       []string // already validated by the caller
    ProjectDir string   // host path; the runner translates as needed
    EventFile  string   // host path the caller will tail; runner ensures writes land here
    Env        []string
    Stdout, Stderr func(string)
}
```

`run.go` / `adhoc.go` / `galaxy.go` / `check.go` / `doc.go` / `inventory.go` /
`vault.go` stop calling `exec.CommandContext` directly — they build `ExecSpec`
and hand it to `engine.runner.Exec`. The callback-plugin dir, extra-vars temp
file, and `INFRAKIT_EVENT_FILE` handling move behind the interface (each runner
decides how to make them visible inside its execution context).

### RuntimeMode

```
system   → ansible-playbook on PATH                         (Linux/macOS)
managed  → InfraKit uv venv  (existing EnsureManaged)        (Linux/macOS)
container→ docker|podman run <image> …                       (any OS incl. Windows)
wsl      → wsl -d <distro> -- …                              (Windows only)
remote   → ssh <linux host> -- …                             (any OS)
auto     → first that Probe()s ready: system → managed → container → wsl
```

Settings `ansibleRuntime` widens from `auto|system|managed` to include
`container|wsl|remote`. `Runtime.Detect` becomes "probe every runner, return the
union"; the active runner is `pick(mode)`.

### capabilities.ansible (extended)

```jsonc
{
  "os": "windows",
  "runtime": "container",
  "runners": {
    "system":  { "ready": false, "reason": "ansible-playbook not on PATH" },
    "managed": { "ready": false, "reason": "no system ansible; uv present" },
    "container": {
      "ready": true, "engine": "docker", "engineVersion": "27.3.1",
      "daemonRunning": true, "image": "infrakit-ansible:local",
      "imageBuilt": true, "ansibleVersion": "2.18.1"
    },
    "wsl": {
      "ready": false, "wslInstalled": true,
      "distros": ["Ubuntu", "docker-desktop"],
      "onlineDistros": ["Ubuntu", "Debian", "kali-linux", "openSUSE-Tumbleweed", "AlmaLinux-9"],
      "infrakitDistro": { "name": "InfraKit-Ansible", "present": false }
    },
    "remote": { "ready": false, "nodeId": "" }
  },
  "install": {
    "docker": "https://docs.docker.com/get-started/get-docker/",
    "podman": "https://podman.io/docs/installation",
    "wsl":    "https://learn.microsoft.com/windows/wsl/install"
  }
}
```

## 3. Runners

### 3.1 LocalRunner  (`system` + `managed`)

Just wraps today's code. `Exec` = `exec.CommandContext` with the project dir +
env; `EventFile` is already a host path. `Setup` for `managed` = the existing
`EnsureManaged` (uv venv). Keeps AN0–AN5 byte-identical on Linux/macOS.

### 3.2 ContainerRunner  (`container`)  — **the Windows unlock**

- **Engine detect:** `docker` then `podman` on PATH; `docker info` /
  `podman info` must succeed (daemon up). Report which + version.
- **Image:** default `infrakit-ansible:local`, built by `Setup` from a
  generated `Dockerfile`:
  ```dockerfile
  FROM python:3.12-slim
  RUN pip install --no-cache-dir ansible-core==<pinned> ansible-lint
  RUN pip install --no-cache-dir <control-node pip packages from settings>
  RUN ansible-galaxy collection install <collections from settings> || true
  RUN useradd -m runner
  USER runner
  ```
  User can override with any image (`quay.io/ansible/ansible-runner`,
  `willhallonline/ansible`, a private registry image, …) → then `Setup` just
  `docker pull`s it.
- **Exec:**
  ```
  docker run --rm --network host \
    -v <ProjectDir>:<ProjectDir>:ro \
    -v <callback-dir>:/opt/infrakit-cb:ro \
    -v <event-dir>:/opt/infrakit-ev \
    -v <ssh-dir-or-agent-sock>:/home/runner/.ssh:ro \
    -e ANSIBLE_CALLBACK_PLUGINS=/opt/infrakit-cb \
    -e ANSIBLE_CALLBACKS_ENABLED=infrakit_events \
    -e INFRAKIT_EVENT_FILE=/opt/infrakit-ev/events.ndjson \
    -e ANSIBLE_HOST_KEY_CHECKING=True \
    -w <ProjectDir> \
    <image> ansible-playbook <argv…>
  ```
  Windows path `C:\Users\…` → docker desktop accepts it as a bind source; the
  in-container path is normalised (`/c/Users/…` or a fixed `/project` mount —
  use a fixed mount point to avoid drive-letter issues, and rewrite the argv's
  playbook path to match).
- **EventFile:** a host tmp dir bind-mounted rw; Go tails
  `<event-dir>/events.ndjson` on the host exactly as today.
- **SSH to targets:** mount `~/.ssh` read-only, or (better) the agent socket
  (`SSH_AUTH_SOCK`, Linux/macOS) / on Windows pass keys from the Vault into a
  tmp 0600 file mounted in. Vault-sourced become/vault passwords: same tmp-file
  pattern, mounted, `defer` removed.
- **`--check` / destructive scan / host-key confirm** unchanged (they act on
  the rendered command, not the runner).
- **Teardown:** `docker rmi infrakit-ansible:local`.

### 3.3 WslRunner  (`wsl`)  — Windows

- **Detect:** `wsl.exe --status` (installed?), `wsl -l -q` (existing distros),
  `wsl -l -o` (official installable list — Ubuntu, Debian, Kali, openSUSE,
  AlmaLinux, …). Parse UTF-16LE output.
- **Provision — two paths, user picks:**
  1. **Official from the list:** `wsl --install -d Debian --no-launch`
     (Debian minimal is the smallest generally-useful; Ubuntu also fine). May
     need a reboot on first-ever WSL install — detect and surface a clear
     "restart Windows, then come back" state.
  2. **Custom rootfs import:** `wsl --import InfraKit-Ansible <install-dir>
     <rootfs.tar[.gz]>` — user supplies a `.tar` (their own hardened image, an
     org base, a `docker export`), or InfraKit downloads a pinned minimal
     Debian/Ubuntu rootfs (verified SHA-256, recorded in
     `vendor-tools/TOOLS.md`) and imports it.
  Either way it lands as a **dedicated distro** (default name
  `InfraKit-Ansible`) — never touches the user's main distro.
- **Setup (post-provision), streamed:**
  ```
  wsl -d InfraKit-Ansible -u root -- bash -lc '
    apt-get update -qq &&
    apt-get install -y -qq python3 python3-pip python3-venv openssh-client git &&
    pip3 install --break-system-packages ansible-core==<pinned> ansible-lint &&
    pip3 install --break-system-packages <control-node pip packages> &&
    ansible-galaxy collection install <collections> || true'
  ```
- **Exec:**
  ```
  wsl -d InfraKit-Ansible -- env ANSIBLE_CALLBACK_PLUGINS=<wsl path> \
    INFRAKIT_EVENT_FILE=/mnt/c/Users/…/events.ndjson … \
    ansible-playbook /mnt/c/Users/…/site.yml <argv…>
  ```
  Path translation: `C:\X\Y` → `/mnt/c/X/Y` (drive letter lower-cased,
  backslash→slash). `safeJoin` still jails on the **Windows** side before
  translation. The callback dir + event file stay on the Windows filesystem
  (under `%LOCALAPPDATA%` / a Windows tmp) so Go tails them natively via the
  `/mnt/c` view; NDJSON line endings — the callback writes `\n`, fine.
- **Python deps live** — a "control-node packages" list in settings; "Apply"
  re-runs the `pip install` step. Same for extra collections.
- **Teardown:** `wsl --unregister InfraKit-Ansible`.

### 3.4 SshRunner  (`remote`)  — any host OS

- **Target:** a `runbook` `ssh_node` (reuse the registry, host-key pinning,
  Vault-sourced key/password — no new auth code) **or** an ad-hoc host in
  settings. One node marked "ansible control node".
- **Setup:** `ssh host -- 'command -v ansible-playbook || (pip install
  --user ansible-core …)'` + the pip-packages / collections list. Detect the
  remote OS + ansible version.
- **Exec:**
  1. sync the project to a remote workdir: `tar -C <ProjectDir> -cf - . | ssh
     host 'mkdir -p <remote>/<proj> && tar -C <remote>/<proj> -xf -'`
     (or `rsync` when present). A "project already lives on the remote"
     option skips the sync (path setting).
  2. `ssh host -- 'cd <remote>/<proj> && env INFRAKIT_EVENT_FILE=<remote-tmp>
     ANSIBLE_CALLBACK_PLUGINS=<remote-cb> ansible-playbook …'` — stream stdout
     over the ssh channel.
  3. event file: `ssh host tail -f <remote-tmp>` in parallel (a second
     channel), fold into SSE like the local tail. Copy the final artifact back.
- **Cleanup:** remove the remote workdir + tmp on run end.
- Reuses the R2 SSH executor's `x/crypto/ssh` + host-key logic — **no new dep.**

## 4. Frontend

- **`RuntimePanel`** (already exists) becomes the mode chooser:
  - a radio / segmented control of the **available** modes (from
    `capabilities.runners`), disabled ones greyed with their `reason`
  - per-mode setup block:
    - `container`: engine + version, "Build image" / "Rebuild" (streamed log),
      image override field, pip-packages + collections editors
    - `wsl`: install-state; if not installed → "Install WSL" button (opens the
      MS docs) ; distro picker = **official list** (`wsl -l -o`) **or** "Import
      custom…" (file path to a `.tar` / "download pinned Debian"); "Set up
      InfraKit-Ansible" (streamed); pip-packages + collections editors;
      reboot-required notice
    - `remote`: `ssh_node` picker (+ "add a node" deep-link to Runbooks →
      Nodes), "project path on remote" / "sync each run" toggle, "Set up
      control node" (streamed), test button
  - an "Install Docker / Podman / WSL" row when nothing is present, linking to
    `capabilities.install.*`
- **First-open:** if `os === "windows"` and no runner is ready → the setup card
  leads with **container** (if a daemon is up) else **wsl**.
- **Status strip:** `ansible via <mode> · <ansibleVersion>` (already shows
  `ansible <runtime>`; extend).
- **Settings → Ansible section** mirrors the same chooser for later changes.
- No new FE dep. All streamed setups reuse the existing SSE `stdout`/`done`/
  `error` pattern (`setupManaged` in `ansibleStore` generalises to
  `runtimeSetup(mode)`).

## 5. Endpoints

| Method | Route | |
|--------|-------|--|
| GET | `/ansible/settings` | now returns `capabilities.runners` + `os` + `install` |
| PUT | `/ansible/settings` (admin) | `ansibleRuntime` accepts the 3 new modes; `containerImage`, `wslDistro`, `remoteNodeId`, `controlNodePipPackages[]`, `controlNodeCollections[]` |
| GET | `/ansible/runtime/setup/stream?mode=` (SSE) | dispatches to the active runner's `Setup` (build image / install+import distro / provision remote) |
| POST | `/ansible/runtime/teardown` | admin — `rmi` / `wsl --unregister` / clean remote |
| GET | `/ansible/runtime/wsl/online-distros` | `wsl -l -o` passthrough (Windows only) |
| POST | `/ansible/runtime/wsl/import` | `{name, source: "official:<d>" \| "tar:<path>" \| "download:debian"}` → provision (streamed via the setup endpoint) |
| GET | `/ansible/runtime/test` | run `ansible --version` through the active runner, return output |

`internal/ansible/runner/` holds `runner.go` (iface) + `local.go` `container.go`
`wsl.go` `ssh.go`. `engine.go` gains `SetRunner` / picks by mode.

## 6. Phases (commit per bullet)

| Phase | Scope | Milestone |
|-------|-------|-----------|
| **AN6a** ✅ `e889f5e` | `Runner` iface (in `package ansible`, not a sub-package) + `localRunner` (all 7 exec sites route through `e.activeRunner(ctx).Command`, zero behaviour change) · per-runner `Probe` · `/ansible/settings` → `runners` + `os` + `install` · `RuntimePanel` 4-mode chooser · install-link row | Nothing regressed; the seam exists. |
| **AN6b** ✅ `e889f5e` | `containerRunner` (docker + podman, `containerEngineName` fast-path for exec + `containerEngine` w/ daemon check for Probe/Setup, `Setup` builds `infrakit-ansible:local` from a generated Dockerfile or pulls an override, `Command` with `/infra-project` `/infra-tmp` `/infra-cb` binds + `~/.ssh` mount + Windows-backslash path rewrite + `ANSIBLE_CONFIG` past the world-writable guard) · Settings container block · pip/collections editors · `/runtime/teardown` | **Verified: run a playbook from Windows in a container, full play/task/host tree.** |
| **AN6c** ✅ `d1dbafd` | `wslRunner` — `wslText` UTF-16LE decode, `wsl -l -q` / `-l -o`, `winToWSL` path translation, `--cd` + `ANSIBLE_CONFIG`, `Setup` provisions the dedicated `InfraKit-Ansible` distro (`official:<name>` OR `wsl --import` a local `.tar` / a downloaded Canonical Ubuntu WSL rootfs — `download.go`, pinned in `vendor-tools/TOOLS.md`) then streamed `apt`+`pip3`, `Teardown` `wsl --unregister` (dedicated-only guard). `WslSetup` panel. | **Verified: run a playbook from Windows in a WSL distro, full tree.** |
| **AN6d** ✅ `ae20044` | `sshRunner` — reuses `executor.SSHRun`/`SSHRunStdin` (new thin exports, no new dep) + `Engine.SetNodeResolver` (ssh-node registry + vault). `Stream` tars the project (in-memory archive/tar) → remote workdir (or `remoteProjectPath`), ships `-e @tmp` files, runs ansible remotely with a marked (`\x01EVT\x01`) `tail -F` of the event file split back into the local file execRun tails. `Setup` installs ansible over SSH. `RemoteSetup` panel (SSH-node picker). | Structurally verified — Probe reaches the SSH handshake, helpers unit-tested. |
| **AN6e** ✅ `a08d1dd` | `Runner.ApplyDeps` + `depLists(settings)` — one `controlNodePipPackages`/`Collections` pair feeds every runner. `EnsureManaged(pip, collections)` + `ApplyManagedDeps` (venv-only); container `ApplyDeps` = rebuild (layer cache); wsl = `pip3` + `ansible-galaxy` skipping apt. SSE `GET /ansible/runtime/deps/apply/stream?mode=`; shared `DepsEditor` panel (managed / container / wsl). | **Verified: `jmespath` applied to a WSL distro, no reprovision.** |
| **AN6f** ✅ `5b9cfa2` | `factCacheEnv` (`ANSIBLE_CACHE_PLUGIN=jsonfile`, `<project>/.facts`) on every playbook + ad-hoc run; `facts.go` `Engine.Facts` (reads the cache) + `GatherFacts` (`ansible -m setup`). `GET /ansible/projects/{id}/facts` + `POST .../facts/gather`. FE `FactsView` — host list + filterable collapsible JSON tree + "Gather". | **Verified: gather localhost → 105 keys, tree + live key filter.** |

**AN6a+AN6b = Windows-usable.** AN6c for the no-Docker Windows case. AN6d for
"my laptop isn't the control node". AN6e/f are polish.

## 7. Dependencies

- **Backend:** **none new.** `docker`/`podman`/`wsl.exe`/`ssh` are OS tools
  invoked like `git`. The pinned WSL rootfs (AN6c, optional) is a downloaded
  data file recorded in `vendor-tools/TOOLS.md` with its SHA-256 — same rule as
  any fetched artifact; it is a Debian/Ubuntu rootfs (their own licensing), not
  bundled in the installer, fetched on demand.
- **Frontend:** none.
- **Bundled binary rule** (`ANSIBLE_MODULE_PLAN.md` / CLAUDE.md): none of
  docker/podman/WSL is ever bundled — detected, with an install link.

## 8. Security

- Container: `--network host` is needed for ansible to reach targets on the LAN
  the same way the host would; document it. No `--privileged`. Non-root user in
  the image. Vault secrets → tmp 0600 files, bind-mounted, `defer` removed,
  never in `docker run` argv or env that survives.
- WSL: the dedicated distro is created by us; `-u root` only for the
  apt/pip setup step, runs unprivileged otherwise. Windows tmp files for
  secrets, 0600-equivalent ACL, removed after.
- Remote: reuses R2's host-key pinning + Vault auth. The synced project is
  removed from the remote on run end. No agent forwarding by default.
- `safeJoin` / path-jail stays on the InfraKit (host) side for every runner,
  before any translation or sync.
- `RuntimeMode` change is an **admin** setting in multi-user mode (instance
  config, like the workspace dir).

Related: [[ansible-module-plan]] (AN0–AN5), [[runbook-module-plan]] (SSH
executor + node registry reused by `SshRunner`), [[user-management-plan]]
(admin-only instance settings), `vendor-tools/TOOLS.md` (pinned rootfs).
