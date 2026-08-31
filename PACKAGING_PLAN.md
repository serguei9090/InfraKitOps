# Packaging & Build — Phase 7

Status: **proposal, not started (2026-09-01).** Expands `MIGRATION_PLAN.md`
Phase 7 into checkpoints now that the Go backend exists and ships as a Tauri
sidecar (`app/src-tauri` → `NETWORK_MODULE_PLAN.md` §2.1, `CLAUDE.md` "sidecar
wiring").

Goal: one reproducible command produces a **signed-or-at-least-clean Windows
installer** that installs → launches → runs a backend tool → uninstalls with no
residue, plus a **static web bundle** that deploys as-is. Linux is best-effort.

---

## 1. What already exists

- `app/src-tauri/` — Tauri v2 shell, `cargo check` green, `identifier
  com.infrakit.studio`.
- `tauri.conf.json` — `bundle.active`, `targets: "all"`, `externalBin` for
  `infrakit-backend` + `infrakit-helper`.
- `capabilities/{default,sidecar}.json` — `default` grants `$APPDATA` fs
  scopes; `sidecar` scopes `shell:allow-spawn` to the backend with an argv
  validator.
- `backend/build-sidecar.{sh,ps1}` — cross-compiles backend + helper into
  `src-tauri/binaries/<name>-<triple>[.exe]`, copies vendored `iperf3`.
- `vendor-tools/` — `fetch-tools.{sh,ps1}` + `tools.lock` + `TOOLS.md`.
- `lib.rs` — spawns sidecar on setup, random 64-hex token, `--parent-pid`,
  `--idle-timeout 45s`, `backend_endpoint` command, kills on exit.

## 2. Known gaps / bugs to fix first (P7a) — **DONE 2026-09-01** (bar icons)

| # | Problem | Status |
|---|---------|--------|
| 1 | `tauri.conf.json` `beforeDevCommand`/`beforeBuildCommand` say `npm run …` — repo is **bun** | ✅ → `bun run dev` / `bun run build` |
| 2 | Version drift: `package.json` `0.0.0`, `tauri.conf.json` `0.1.0`, `Cargo.toml` `0.1.0` | ✅ all three `0.1.0`; new `bun run set-version <x>` (`app/scripts/set-version.ts`) writes all three, no-arg = drift check (exit 1 on mismatch — wire into CI in P7h) |
| 3 | `Cargo.toml` `description = "A Tauri App"`, `authors = ["you"]` | ✅ real description + author + `license = "MIT"`. Root `LICENSE` (MIT, © 2026 InfraKit Studio) added; `app/package.json` `"license": "MIT"`. **`name = "app"` left as-is** — renaming ripples through `[lib] name`, `target/`, cosmetic; skip. |
| 4 | Icons are the **default Tauri logo** (`icon.icns` is Tauri's) | ⏳ **open** — needs a 1024² brand source PNG, then `bun tauri icon <src>`. Tracked as P7a-icons. |
| 5 | Default window `800×600` — app shell is designed wider | ✅ `1280×832`, `minWidth 960`, `minHeight 600` |
| 6 | `security.csp: null` (dev-permissive) | ✅ set: `default-src 'self'; connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:* http://localhost:*; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'`. **Only applies to the packaged build — must be re-verified in P7e** (a too-tight CSP shows as a white screen / blocked requests; `connect-src` covers the sidecar's random `127.0.0.1` port + dev). |

`cargo check` + `bun run build`/`test`/`lint` green after the change.

## 3. Decisions to lock (open questions)

| # | Question | Default if unanswered |
|---|----------|----------------------|
| A | Installer format — **NSIS** (`.exe`, per-user, no admin) vs **MSI** (`.msi`, WiX, admin, GPO-deployable) vs both | **NSIS** primary (per-user install, matches "solo/local-first"); MSI as a later add |
| B | Code signing — real cert now, or ship unsigned + document SmartScreen | **unsigned now**, leave `signCommand` hook wired + a `SIGNING.md` note; revisit when a cert exists |
| C | Auto-updater (`tauri-plugin-updater` + static `latest.json`) | **out of scope for P7** — manual download; wire in a later phase |
| D | Helper elevation — the `infrakit-helper` UAC path for hosts/firewall writes on a *packaged* install (path resolution differs from dev) | must be tested in P7e; no code change expected, `elevate` resolves the helper next to the backend |
| E | Bundle the GPL-incompatible / optional tools (`iperf3` non-Windows only today) | keep current rule — Windows installer ships **no** `iperf3`; the tool shows "install iperf3" state |

## 4. Phases

### P7a — Config hygiene — **DONE 2026-09-01** (commits `9927219`, `<licence>`), except:
- **P7a-icons** (open, deferred by owner 2026-09-01): generate brand icons
  from a 1024² source PNG via `bun tauri icon <src>`. Until then the app ships
  the default Tauri logo.
- CSP correctness is only provable in P7e (packaged run).

### P7b — Sidecar build wired into `tauri build` — **DONE 2026-09-01** (commit `<p7b>`)
- `app/scripts/build-sidecar.ts` + `bun run build:sidecar` (`--all` for
  windows+linux). Runs, from the repo root: `vendor-tools/fetch-tools.{sh,ps1}`
  (SHA-256-verify iperf3) → `backend/build-sidecar.{sh,ps1}` (backend + helper
  → `app/src-tauri/binaries/<name>-<triple>[.exe]`, copies matching iperf3).
  Picks `.ps1` on win32, `.sh` elsewhere.
- **Not** auto-run by `tauri build` — Tauri has no portable pre-bundle hook
  for cross-compiled Go. It's a manual/CI pre-step; `externalBin` fails loudly
  if the binaries are missing.
- Verified: `bun run build:sidecar` on Windows produces
  `infrakit-backend-x86_64-pc-windows-msvc.exe` (~20 MB) +
  `infrakit-helper-…exe` (~2.7 MB); no Windows iperf3 by design.
- `CLAUDE.md` Commands + the "build the sidecar before tauri dev/build" note
  updated to point at `bun run build:sidecar`.
**DoD**: `bun install && bun run build:sidecar && bun run tauri build` — see
the Verification log for the first full run.

### P7c — Capability / permission least-privilege audit — **analysed 2026-09-01, change deferred to P7e**

Frontend Tauri surface (grep of `@tauri-apps/*` + `invoke(` in `app/src`, test
files excluded) is tiny:

| Call site | API | Scope actually used |
|---|---|---|
| `backendClient.ts`, `sseClient.ts` | `invoke('backend_endpoint')`, `isTauri()` | custom command — allowed by default in Tauri v2, no capability entry needed |
| `createStoragePort.ts` | `isTauri()` | — |
| `tauriFsStoragePort.ts` | `@tauri-apps/plugin-fs`: `exists`, `mkdir`, `readTextFile`, `writeTextFile` | **only** `$APPDATA/` (the dir) + `$APPDATA/storage.json` |

No `dialog`, no `shell` from JS (`shell:allow-spawn` in `sidecar.json` is
Rust-side, already scoped to the one binary). The Go backend writes its own
DBs (`%APPDATA%\InfraKitStudio\*.db`, `vault.enc`) directly — not through
Tauri, no capability involved.

**Current `default.json` is too broad** — `fs:allow-appdata-{read,write,meta}-recursive`
grants the webview read/write to *everything* under `%APPDATA%`. Proposed
tightening:

```jsonc
"permissions": [
  "core:default",
  { "identifier": "fs:allow-exists",         "allow": [{ "path": "$APPDATA" }, { "path": "$APPDATA/storage.json" }] },
  { "identifier": "fs:allow-mkdir",           "allow": [{ "path": "$APPDATA" }] },
  { "identifier": "fs:allow-read-text-file",  "allow": [{ "path": "$APPDATA/storage.json" }] },
  { "identifier": "fs:allow-write-text-file", "allow": [{ "path": "$APPDATA/storage.json" }] }
]
```

**Why deferred**: an over-tight fs scope fails *silently* (the adapter catches
and returns `{}` → desktop prefs quietly stop persisting). Needs a real
`tauri dev` / packaged run to confirm — do it as the first step of P7e, not
blind. Also add `capabilities/README.md` documenting each grant then.

### P7d — Windows installer
- NSIS config in `tauri.conf.json` `bundle.windows.nsis` — per-user,
  `installMode: "currentUser"`, start-menu shortcut, license page pointing at
  a bundled `LICENSE`.
- `bundle.resources` — bundle `vendor-tools/TOOLS.md` + license texts
  (attribution obligation, `CLAUDE.md` "bundled-binary license rule").
- WebView2: `bundle.windows.webviewInstallMode` = `downloadBootstrapper`
  (smallest) — document the offline-install alternative (`embedBootstrapper`).
**DoD**: `*.exe` installs to `%LOCALAPPDATA%\InfraKit Studio`, launches from
the Start menu. One commit.

### P7e — End-to-end verification gate (manual, gates "done")
The bar from `MIGRATION_PLAN.md` Phase 7 + `README.md` Phase 5:
1. Clean Windows VM/user. Install the `.exe` silently (`/S`).
2. Launch → shell renders → open **Network Toolkit → DNS Lookup**, run a
   query → backend sidecar answered (proves spawn + token + endpoint).
3. **Runbooks** → unlock a vault, run a `powershell` step → executor works
   packaged.
4. **Hosts editor** → apply a change → UAC prompt → `infrakit-helper`
   elevates and writes (proves §3-D).
5. Quit → Task Manager shows no orphaned `infrakit-backend.exe`.
6. Uninstall → `%LOCALAPPDATA%\InfraKit Studio` gone; `%APPDATA%\InfraKitStudio`
   (user data) **kept** by design — document that.
Record the run in `PACKAGING_PLAN.md` (this file) under "Verification log".

### P7f — Web static build
- `bun run build` → `dist/` deploys to any static host. Confirm it runs with
  **no backend** (client-only 44 tools) and with `VITE_BACKEND_URL` set
  (network/runbook/AI tools light up).
- Add a `dist/` smoke check to CI (serve + a Playwright/`curl` 200 on `/`).
- Document the `VITE_BACKEND_URL` / `VITE_BACKEND_TOKEN` contract for a
  self-hosted backend deployment.
**DoD**: documented in `README.md`; CI serves the bundle. One commit.

### P7g — Linux (best-effort, may slip)
- `build-sidecar.sh --all` already cross-compiles the linux backend.
- `tauri build` on a Linux runner → `.deb` + AppImage. WebKitGTK dependency
  note.
- Not a release blocker; CI job `continue-on-error` until a Linux user exists.

### P7h — CI
- `.github/workflows/release.yml` — on a `v*` tag: matrix (windows, ubuntu),
  `build-sidecar` → `fetch-tools` → `tauri build` → upload artifacts to a
  draft GitHub Release. `tauri-action` does most of this.
- Keep the existing `backend.yml` / `links.yml`; add a `frontend.yml` running
  `build + test + lint` on PRs to `main` if not already there.

## 5. Risks

- **Go cross-compile in CI** — `CGO_ENABLED=0` already; `modernc.org/sqlite`
  is pure-Go, no cgo. Should be clean.
- **`tauri build` needs the frontend built first** — `beforeBuildCommand`
  handles it, but the sidecar step is separate and easy to forget → make it a
  loud failure (`externalBin` missing → Tauri errors clearly).
- **WebView2 not present on very old Windows** — bootstrapper handles it;
  document minimum Windows 10 1803.
- **Antivirus / SmartScreen on the unsigned `.exe`** — expected; §3-B.

## 6. Verification log

_(fill in P7e runs here)_
