# InfraKit Studio

Local-first SRE / SysAdmin / developer workbench — one React codebase, delivered as a
native Windows desktop app (via Tauri v2) **and** a static web app. See
[`InfraKit Studio Specification.md`](InfraKit%20Studio%20Specification.md) for the full
product spec, [`design.md`](design.md) for the UI/architecture rationale carried over
from the original build, and [`CLAUDE.md`](CLAUDE.md) /
[`MIGRATION_PLAN.md`](MIGRATION_PLAN.md) for the React/Tauri stack decision and the
Flutter→React migration history.

## Status

**Full 44-tool parity reached (2026-08-25).** Every tool from the original Flutter
build now has a live React screen at `/tools/*`, backed by fully-ported core logic
(41 files, 954 Vitest tests) and persistent storage (web `localStorage`, desktop a
real file via the Tauri `fs` plugin). See `MIGRATION_PLAN.md` for the phase-by-phase
history — Phases 0–6 done, Phase 9 (this README rewrite, archiving the old Flutter
source) in progress, Phases 7 (packaging) and 8 (Go backend) intentionally not
started yet.

The original Flutter implementation (44 tools, feature-complete) has been archived
to [`archive/flutter-app/`](archive/flutter-app/) — kept for reference during the
migration, not deleted, in case a regression surfaces post-cutover. It is no longer
built, run, or maintained.

## Stack

- React 19 + TypeScript + Vite, Tailwind v4, shadcn/ui (Base UI primitives).
- Desktop shell: Tauri v2 (WebView2 on Windows).
- State: Zustand. Routing: `react-router`. Forms: `react-hook-form` + `zod`.
- No backend yet — every tool runs entirely client-side (browser or native webview),
  matching the original spec's "client-first" constraint (§5). A Go backend for
  ansible/ssh execution and local model serving is planned but not started — see
  `CLAUDE.md`.

See `CLAUDE.md` for the full stack rationale and why each library was chosen.

## Architecture

Strict hexagonal (ports & adapters) — see `design.md` and `CLAUDE.md` for the full
write-up:

- `app/src/core/**` — pure TypeScript domain logic. Zero React imports, enforced by a
  grep check before any PR (see `CLAUDE.md`'s "Adding a new tool" section).
- `app/src/core/ports/**` — the inbound/outbound interfaces (`IToolUseCase`,
  `IFormFlowUseCase`, `ISchemaRepository`, `IStoragePort`) that adapters implement.
- `app/src/adapters/ui/**` — React components: the persistent shell (`shell/`) and one
  screen per tool (`tools/`).
- `app/src/adapters/storage/**` — persistence adapters (web `localStorage`, desktop
  Tauri `fs` plugin) implementing the storage ports.

## Development

Run from `app/`:

```bash
bun install              # install deps
bun run dev               # Vite dev server (web) — http://localhost:1420
bun run tauri dev         # Tauri desktop dev (wraps the same Vite dev server)
bun run test               # Vitest, core logic unit tests
bun run build               # static web build (tsc -b && vite build)
bun run tauri build         # desktop installer (MSI/NSIS via Tauri bundler)
```

Check the hex-architecture boundary hasn't been violated (no React imports crept into
the core):

```bash
grep -rl "from 'react" app/src/core   # must print nothing
```

## Adding a new tool

1. Core logic: `app/src/core/<domain>/<tool>.ts`, implementing
   `IToolUseCase<TInput, TOutput>`. Unit test alongside it.
2. Screen: `app/src/adapters/ui/tools/<Tool>Screen.tsx`, built on the shared
   `ToolDetailScaffold` layout component.
3. Register: one entry in `app/src/adapters/ui/shell/moduleTaxonomy.ts` + one route in
   `app/src/routes.tsx`.

See `CLAUDE.md` for the full walkthrough and conventions.

## Roadmap / deferred

Tracked in more detail in `MIGRATION_PLAN.md`, `NETWORK_MODULE_PLAN.md`, and
`CLAUDE.md`; the shortlist:

- **Tauri packaging (Phase 7)** — MSI/NSIS installer via the Tauri bundler.
  `bun run tauri dev` opening a real native window still needs a manual pass.
- **Go backend (Phase 8)** — beyond the network-diagnostics scope already
  started: ansible / ssh command execution, local model serving.
- **Route-based code-splitting** — the production bundle is ~2.8 MB
  (~900 KB gzipped); `React.lazy` per route, worth doing before Phase 7.
- **RDP File Builder — "make it read-only" automation.** The tool emits
  *instructions* for `attrib +R` (read-only on disk) and `rdpsign.exe
  /sha256` (tamper-proof signature); both are run by the user after saving.
  To reduce that to one step:
  - a "Download lock script" button emitting `lock-connection.ps1`
    (`attrib +R`, plus the `rdpsign` line when a thumbprint is supplied);
  - an optional cert-thumbprint field that fills the real value into the
    header and the script;
  - a "header-off" output toggle so the signed copy has no `#` comment lines.

  `attrib +R` can only be applied automatically in the Tauri desktop build
  (Rust `set_permissions`), not the web build — a browser download always
  lands writable. Signing stays the user's job (their cert, their private
  key, Windows-only `rdpsign.exe`).
- **Config-builder "import existing config".** The config builders (SSH,
  sysctl, Zabbix, RDP, Web Server, Fail2ban) only *generate* files today.
  Loading an existing config to pre-fill the form would need a reverse
  parser per tool — tracking every argument/combination that maps back to a
  form control. Deferred until there's demand; not a small change.
- **Tuning calculators wave 3** — backup window & RTO, VPC CIDR carve-up,
  on-call staffing, replication lag / RPO, MTU/MSS overhead, rate-limit /
  token-bucket (see `TUNING_CALCULATORS_PLAN.md`).
