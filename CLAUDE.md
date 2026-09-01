# InfraKit Studio — CLAUDE.md

Project guidance for Claude Code sessions working in this repo. Product context lives in
[`InfraKit Studio Specification.md`](InfraKit%20Studio%20Specification.md), UI/architecture
rationale in [`design.md`](design.md), migration rationale/steps in
[`MIGRATION_PLAN.md`](MIGRATION_PLAN.md).

## Stack decision (2026-08-25)

Migrating off Flutter. Target stack:

- **Frontend**: React 18 + TypeScript + Vite. Runs unmodified as a static web app AND
  inside a Tauri webview as the desktop app — one codebase, two targets, same property
  the old Flutter app had (`flutter build web` / `flutter build windows`).
- **Desktop shell**: Tauri v2 (stable, currently 2.10.x). WebView2 (Windows) / WebKitGTK
  (Linux), not bundled Chromium — small binary, native installer (MSI/NSIS) via the
  built-in bundler, replaces the old Inno Setup script.
- **Backend (later phase, not yet started)**: Go service for ansible/ssh command
  execution and local model serving (Ollama-style). Ships either as a standalone HTTP
  service the web build talks to, or as a **Tauri sidecar** (external binary Tauri
  spawns/manages) for the desktop build — see
  [Tauri sidecar docs](https://v2.tauri.app/develop/sidecar/). Until this phase starts,
  the app stays client-only, same constraint the Flutter version had.
- **UI kit**: shadcn/ui + Tailwind CSS. Deliberately chosen to match the existing
  "Linear/Vercel-style premium dev tool" visual target in `design.md` — shadcn's default
  aesthetic already reads that way, so the theme port is a token translation, not a
  redesign. Icons: `lucide-react` (closest match to the Material icons used today).
- **State**: Zustand for the small amount of global state (theme, module
  order/visibility prefs). Most tools are locally self-contained (mirrors the old
  Riverpod usage — most providers were screen-scoped, not global).
- **Routing**: `react-router` (v6+), one `ShellRoute`-equivalent layout route wrapping
  the persistent rail + swap pane, matching `app_shell.dart`'s current structure.
- **Forms**: `react-hook-form` + `zod`. Chosen specifically for FormFlow (dynamic
  array-loop fields) — `useFieldArray` is the direct equivalent of the current dynamic
  array loop handling in `formflow_parser.dart`.
- **Testing**: Vitest + React Testing Library for units/components (mirrors
  `test/core/**` Dart unit tests).

## Why this over Tauri+Rust-for-everything or staying Flutter

Compared during planning (see chat history, not re-litigated here): Go was picked over
Rust for the eventual backend because this app's backend work is infra-tooling-shaped
(concurrent ssh/ansible process exec, model serving) — Go's ecosystem (Ollama itself is
Go) and simpler concurrency model fit better than Rust's, and it's faster to iterate on
with AI assistance. React was picked over keeping Flutter for ecosystem size (component
libraries, AI training coverage, faster "vibecode" iteration) and because it collapses
naturally into both a webapp and a Tauri desktop app from the same build, whereas
Flutter's dual-target story required its own web/desktop split. Tauri was kept over
Electron for bundle size (WebView2 vs bundled Chromium) and because it wraps the same
React output rather than requiring a separate app shell language.

## Architecture — hexagonal, ported 1:1

The Flutter app's ports & adapters structure carries over directly; only the language
and adapter implementations change:

| Flutter (old)                  | React (new)                          | Notes |
|---------------------------------|---------------------------------------|-------|
| `lib/core/**`                   | `src/core/**`                         | Pure TS, zero React imports — same rule as the old "zero `package:flutter` imports" check |
| `lib/core/ports/**`             | `src/core/ports/**`                   | TS interfaces (`IToolUseCase`, `IStoragePort`, etc.) |
| `lib/adapters/ui/shell/**`      | `src/adapters/ui/shell/**`            | Icon rail + swap pane shell, theme, module taxonomy |
| `lib/adapters/ui/tools/**`      | `src/adapters/ui/tools/**`            | One component per tool |
| `lib/adapters/storage/**`       | `src/adapters/storage/**`             | Web: `localStorage`/IndexedDB. Desktop: Tauri `fs` + `dialog` plugins |
| `lib/adapters/server/**` (`--serve`) | *(future, Go backend phase)*     | Static file serving moves to the Go service instead of the frontend |

Rule carried over unchanged: **no UI framework imports in `src/core/**`.** Check before
any PR:

```bash
grep -rl "from 'react" app/src/core   # must print nothing
```

Adding a new tool stays a small, mechanical change (same reason the Flutter version
called this out — it's what let unrelated background agents build tools in parallel
with zero file conflicts):

1. Core logic: `src/core/<domain>/<tool>.ts`, implementing `IToolUseCase<TIn, TOut>`.
   Unit test alongside it.
2. Screen: `src/adapters/ui/tools/<Tool>Screen.tsx`. Pick the layout archetype
   (all built on the shared `ToolScaffoldHeader`/`ToolScaffoldPanel`):
   - **`ToolDetailScaffold` (T1)** — input | live-output split. Default; use
     when the output is edited against live (Chmod, Docker Run→Compose,
     Crontab, most utilities).
   - **`GeneratorScaffold` (T5)** — single-column form, output reached from
     the header (`Validate` · `Download` · `Preview` · `Copy`), file shown in
     a modal. Use for the **config-file builders** (SSH, sysctl, Zabbix, RDP,
     Web Server, Database, Fail2ban, Firewall Rule) — output is a result you
     grab when done, not a second pane. Pass `validate={{ kind, text }}` to
     get the header Validate action (`nginx -t` / `sshd -t` / `nft -c` / … —
     hidden until the backend service is connected).
   - **`BalancedFlowScaffold` (T2)** — wide config band + results/preview
     split. Sizers/calculators with genuine computed results (DB RAM Sizer,
     Zabbix Sizer, Ceph PG, Firewall Command).
   - **`StepperWorkspaceScaffold` (T3)** — row-by-row workflows (PDF Split &
     Merge). **`NetworkToolScaffold` (T4)** — network tools (see below).

   **Catalog config builders** (SSH, sysctl, Zabbix, RDP) render their
   directive catalog through `adapters/ui/config/DirectiveCatalogEditor` —
   map the tool's `Xxx[]` catalog to `CatalogItem[]` and pass `groups` /
   `values` / `onChange` / `presets`; the editor owns the grouped list,
   search, "selected only" filter, per-kind control and preset buttons, and
   the screen keeps its `execute()` serializer. (Builders with nested/
   interdependent output — Web Server, Database — or a multi-field-per-row
   catalog — Fail2ban jails — pass bespoke form fields to `GeneratorScaffold`
   instead.)
3. Register: one entry in `src/adapters/ui/shell/moduleTaxonomy.ts` + one route in
   `src/routes.tsx` — use the `lazy:` form like every other tool route
   (`{ path: 'tools/x', lazy: () => import('...').then((m) => ({ Component: m.XScreen })) }`),
   not an eager `element:` import.

All paths in this section and the table above are relative to `app/` (see Commands).

## Status

**Migration done, Phases 0–6 and 9 complete (2026-08-25).** Full 44-tool parity with
the Flutter app reached; every tool is live at `/tools/*` with persistent storage.
The Flutter implementation has been archived to
[`archive/flutter-app/`](archive/flutter-app/) (its `lib/`, `windows/`, `linux/`,
`web/`, `packaging/`, `test/`, `pubspec.*` — kept for reference, not deleted, in case
a regression surfaces post-cutover; it is not built or maintained anymore). `app/`
is now the only active codebase. Phases 7 (Tauri packaging) and 8 (Go backend) are
intentionally not started — no Go backend work until the frontend is fully settled,
matching the original spec's client-first constraint (§5). See `MIGRATION_PLAN.md`
for the full phase-by-phase history.

App in `app/`:
- Vite + React 19 + TypeScript, Tailwind v4, shadcn/ui (indigo `#4F46E5` seed color
  ported into `app/src/index.css`'s `--primary`/`--ring`/`--sidebar-primary` tokens,
  light + dark). shadcn resolved to **Base UI primitives** (`@base-ui/react`), not
  Radix — no `asChild`, composition via a `render` prop instead; keep that in mind in
  later phases.
- Tauri v2 shell in `app/src-tauri/` (`identifier: com.infrakit.studio`), `cargo check`
  passes, `tauri info` reports a clean environment (WebView2, MSVC, Rust toolchain all
  green).
- Full shell UI working: icon rail + swap pane (`AppSidebar.tsx`), top bar with search +
  theme toggle (`AppShellScaffold.tsx`), "All Tools"/per-module pages
  (`HomeDashboardScreen.tsx`/`ModuleToolsScreen.tsx` + shared `ModuleSectionView.tsx`),
  module reorder/hide dialog (`ModuleSettingsDialog.tsx`), and the full 44-tool
  `moduleTaxonomy.ts`. Zustand stores in `app/src/stores/`.
- `app/src/core/**` fully populated — every `lib/core/**` file ported, including
  `office_media/` (Phase 4) and `form_flow/` (Phase 5, which also needed a
  narrowly-scoped `ISchemaRepository` + `localStorage` adapter — see
  `MIGRATION_PLAN.md`'s Phase 5/6 notes, not a general `IStoragePort` yet).
  954 Vitest tests passing, zero React imports (hex boundary intact).
- **All 44 tools are live** at `/tools/*`, built on `ToolDetailScaffold.tsx`
  (`app/src/adapters/ui/tools/*.tsx`) — full parity with the Flutter reference app
  reached. Two screens (Data Converter, Formatters) combine 4 core files each behind
  `Tabs`; Knowledge Hub's list-style tools (Documentation, Reference Lists,
  Study & Practice, plus the "AI & Automation" group — MCP Servers, AI
  Frameworks, AI Software, AI Skills, Automation, AI Models, Dev Services, AI
  Catalogs — added 2026-08-28, see `KNOWLEDGE_HUB_AI_EXPANSION_PLAN.md`) all
  share one `ResourceLinkListView.tsx` component over the single
  `EXTERNAL_RESOURCE_LINKS` list in `cheatsheetContent.ts`
  (`ResourceType`-tagged, `isDirectory` flag for aggregators;
  `bun run check:links` link-health + dedupe script + `.github/workflows/links.yml`);
  FormFlow's designer/live-form is driven by `react-hook-form`'s
  `useFieldArray` (the reason that library was picked back in the stack-decision
  phase). Verified end-to-end in-browser throughout (not just typechecked): full
  build clean, all 954 core tests passing, hex boundary intact, a real QR
  generate→decode round trip through actual `File`/`DataTransfer` upload
  simulation, and a full FormFlow round trip (parse → retype a field to a dynamic
  array loop → add/edit items with confirmed per-index isolation → save → reload →
  byte-for-byte restore → delete). Bundle: **route-split done 2026-09-01**
  (`CODE_SPLITTING_PLAN.md` CS0+CS1) — every `/tools/*` + `/settings*` route is
  `lazy:` in `routes.tsx`, entry chunk 989KB → **47KB gzip** (+ a stable
  `vendor-react` 90KB gzip). `manualChunks` in `vite.config.ts` is
  **function-form only** under rolldown-vite.
- `npm run build` (web) and `cargo check` (desktop shell) both verified early on. **Not
  yet verified**: `npm run tauri dev` opening an actual native window — that launches a
  GUI process this environment can't observe; run it yourself once to confirm.
- **Prompt Library** module (`moduleTaxonomy.ts` id `prompt`, route
  `/tools/prompt-library`) — **P1 + P2 shipped 2026-08-29**. Client-only prompt
  authoring: one-level folders (move via a header `Select`), tags, ordered
  system/user/assistant messages, `{{VAR}}` auto-detect, Fill & Copy (per-message
  + copy-all, 4 formats), full version history (`Save · v{n}`, read-only view,
  restore, pin, per-version delete, word-level compare), autosaved draft with
  Discard. Custom **T6 "Library Workspace"** three-pane scaffold
  (`adapters/ui/prompt/`). Core in `src/core/prompt/**` (framework-free),
  persistence via `promptRepository.ts` on `IStoragePort` (index + per-prompt
  keys, like `schemaRepository.ts`). Single-tool shell module —
  `ModuleDef.hideToolPane` + `moduleRailRoute()` open it directly from the rail
  (FormFlow now also skips its one-card page). Plan + phases:
  [`PROMPT_MODULE_PLAN.md`](PROMPT_MODULE_PLAN.md). **P1–P4 done** — 10 full
  IT-troubleshooting seed templates + gallery + promote-to-template; dnd
  reorder (messages + tree prompts/folders); export/import JSON
  (`core/prompt/promptIo.ts`); ⌘S / ⌘↵ shortcuts. Deferred: responsive Tabs.
  **LLM runtime (playground / connect Ollama·LM Studio·OpenAI·Anthropic·Gemini)
  is deferred to P5** — `src/core/prompt/ai/` stays interfaces-only until then,
  no networking code.
- Package manager: **bun** (user preference, 2026-08-25 — switched from the initial npm
  scaffold; `bun.lock` is the lockfile, `package-lock.json` removed). Use `bun`/`bunx`,
  not `npm`/`npx`, for everything in `app/` from here on.

## Network module + Go backend (started 2026-08-27, N0 done)

The **Network Toolkit** module (`moduleTaxonomy.ts` id `network`) is the first part of
the app with a **backend process** — it starts the deferred Phase 8, scoped to network
diagnostics only. Plan + roadmap: [`NETWORK_MODULE_PLAN.md`](NETWORK_MODULE_PLAN.md).

- **`backend/`** — a Go module (`github.com/infrakit/backend`). One binary,
  `cmd/infrakit-backend`, that runs as a **Tauri sidecar** on desktop and a standalone
  HTTP service for web. `chi` router under `/api/v1`, per-launch bearer-token auth,
  SSE for streaming tools. `go test ./...` from `backend/`.
- **Firewall write CRUD (v1, Windows-only, 2026-08-27)**: `internal/fwspec` is the
  pure dep-free change model (strict `RuleSpec.Validate` / `NetshArgs` /
  `AssessLockout`), imported by both the `firewall` package and the elevated
  `infrakit-helper` (`firewall-exec` op) — the helper re-derives the `netsh` argv
  from the same code so a caller can't inject arguments. `POST /firewall/change`
  returns `{needsConfirmation, warnings}` for lockout-risky edits. Linux firewall
  write is still deferred.
- **Sidecar wiring**: `app/src-tauri/src/lib.rs` spawns it on setup, reads
  `LISTENING <addr>` off stdout, exposes `{ endpoint, token, available }` via the
  `backend_endpoint` command, kills it on exit. `capabilities/sidecar.json` scopes
  `shell:allow-spawn` to the one binary with validated args.
- **Build the sidecar binary before `tauri dev`/`tauri build`**: `bun run
  build:sidecar` (from `app/`; `--all` = windows+linux) — runs
  `vendor-tools/fetch-tools` then `backend/build-sidecar` into
  `app/src-tauri/binaries/<name>-<triple>` (git-ignored). `tauri build` does
  NOT run this itself (no portable pre-bundle hook for cross-compiled Go);
  `externalBin` fails loudly if the binaries are absent.
- **Frontend**: `adapters/backend/backendClient.ts` + `stores/backendStore.ts`
  (`backendAvailable` status + per-tool capability map). Network tool screens use the
  **T4 `NetworkToolScaffold`** (`adapters/ui/network/`), not `ToolDetailScaffold`, and
  fall back to a "backend unavailable" state. The 44 client-only tools are untouched.
- **Still framework-free**: `src/core/network/**` (subnet calc moved here, plus
  `hostRange.ts`) has zero React imports, same as the rest of `src/core`.
- CI: `.github/workflows/backend.yml` (vet/test + cross-compile). `bun run tauri dev`
  opening a real window still needs a manual pass — same caveat as the rest of the app.

### Runbooks module (started 2026-08-31, R0–R4 done bar the AI Assistant)

**Runbooks** (`moduleTaxonomy.ts` id `runbook`, route `/tools/runbook`) is a
**backend-mandatory** module for reusable multi-step command runbooks — the
second big consumer of the Go backend. Plan + phases:
[`RUNBOOK_MODULE_PLAN.md`](RUNBOOK_MODULE_PLAN.md).

- **Backend**: `internal/vault/` (Argon2id → AES-256-GCM, `vault.enc` file,
  RAM-only key, auto-lock), `internal/executor/` (executor adapters — R0:
  powershell/cmd/bash; SSH + HTTP in R2), `internal/orchestrator/`
  (`orchestrator.db`, `{{VAR}}`/`{{secret:NAME}}`/`{{steps.N.stdout}}` render +
  server-side secret **redaction** everywhere, destructive-pattern scan, run
  engine over SSE with a concurrency cap). `capabilities` gains `runbook` +
  `runbookExecutors`. No new Go deps (`x/crypto/ssh`+`argon2` already vendored).
- **Frontend**: `src/core/runbook/**` (framework-free), `runbookClient.ts`
  (normalises Go's `null` slices), `runbookStore` + `vaultStore`, T7 **"Console
  Workspace"** scaffold (`adapters/ui/runbook/` — own top nav, not a sidebar),
  single-tool shell module.
- **No dedicated Ansible / kubectl executor** — run them as plain commands in a
  shell/SSH step (§3.3). Ansible + kubectl get their own modules later.
- **R0–R4 done** (except the AI Assistant). R1 = full-page editor, args
  auto-detect + per-arg validation, versioning (`runbookDiff`), publish gate.
  R2 = **SSH** executor (`x/crypto/ssh`, host-key pinning) + **HTTP** executor
  (status + dot-path asserts, chains via `{{steps.N.stdout}}`) + `SshNodesView`
  + `SecretPicker`. R3 = `internal/packages` (detect + install-command per
  manager + streamed install) + `orchestrator/sync.go` (library export/import
  as `<slug>.runbook.json` files + optional git) + single-runbook JSON
  export/import + ⌘S/⌘↵. **R4**: R4a Python-via-`uv` executor
  (`executor/python.go`, 6th kind, gated on `uv` on PATH); R4b scheduled/cron
  runs (`orchestrator/{cron,scheduler}.go` — self-contained 5-field parser +
  30s poll, published-only, `triggeredBy="schedule"`; `Schedules` nav section
  + `core/runbook/cron.ts`); R4c dnd step reorder (`@dnd-kit`, up/down buttons
  kept as fallback) + responsive editor grid; R4d opt-in OS-keyring vault key
  (`vault/keyring_windows.go` → Windows Credential Manager via advapi32, no new
  dep; auto-unlocks the vault after a backend restart). **Still deferred**: AI
  Assistant (reuses Prompt Library P5 model connections), multi-user approvals,
  run artifacts, macOS/Linux keyring backends.

### AI module — "AI Hub" (started 2026-08-31, A0–A2 done)

Central LLM layer every module reuses instead of wiring its own AI. Plan +
phases: [`AI_MODULE_PLAN.md`](AI_MODULE_PLAN.md). Supersedes the never-built
`core/prompt/ai` stub; delivers the deferred Prompt Library P5 + Runbooks R4
Assistant.

- **Backend `internal/llm/`** — `Provider` adapter iface (`ollama` +
  `openai-compatible` in A0; `anthropic` + `gemini` in A2), `Connection`
  registry in a **new pure-Go `llm.db`** (`--llm-db`, sibling of
  `orchestrator.db`), `Engine` (key resolution via the **Vault**, 60 s model
  cache, streamed `Chat`). Endpoints `/llm/connections*`, `/{id}/{test,models}`,
  `/llm/chat/stream` (SSE). **Zero new Go deps** — no SDK / agent framework
  (Python-only, breaks the one-binary sidecar model; wire formats are ~80
  lines each; `openai-compatible` covers most of the market). Rationale
  recorded in `AI_MODULE_PLAN.md` §6.5.
- **Frontend** — `core/llm/**` (framework-free), `llmClient.ts`, `llmStore`
  (Zustand chat buffer over the existing `openStream` SSE client — no Vercel
  `ai` SDK), T7 `AiConsoleScaffold` (Playground + Connections), rail module
  `ai` (`hideToolPane`), backend-mandatory.
- **Grounding = Task** (A1, done): a module adds AI via one built-in `Task` in
  `internal/llm/task.go::Builtins()` (id + `{{context.*}}` system template +
  `text`/`diff`/`json` output shape) + a drop-in
  `<AiPanel taskId context onAccept />` / `useLlm(taskId)` from
  `adapters/ui/ai/`. No change to the central layer, `App`, or routes.
  Same-id custom rows in `llm_task` override a builtin (Reset drops the
  override). `internal/templating/` is the shared `{{TOKEN}}` engine (runbook
  + llm). First consumer: Prompt Library **"Improve"** (Sparkles on
  `MessageCard`).
- **A2 done**: `anthropic` + `gemini` native adapters (all 4 providers live);
  `AiPanel` `mode="chat"` + `onAcceptJson`; Runbooks **Assistant** tab
  (`AssistantView`, `runbook.assistant` task, chat grounded on the spec) +
  editor "Generate step" (`runbook.gen-step` → append) + per-`StepCard`
  "Explain" (`command.explain`).
- **AI Stop** (2026-09-01): `AiPanel` + Playground get a Stop button while
  generating (`useLlm.cancel` / new `llmStore.stopChat`); `llmStore` `busy`
  stays true for the whole stream so Stop shows during model spin-up too.
- **A3 planned** (`AI_MODULE_PLAN.md` §A3): history persistence, token/cost,
  embeddings, reliability. **A4 = MCP tools + tool-calling** — own plan
  [`AI_MCP_PLAN.md`](AI_MCP_PLAN.md). **A4a done 2026-09-01**: `internal/mcp/`
  on `modelcontextprotocol/go-sdk` v1.7.0 (first new backend dep since the LLM
  module — MIT/Apache) — `mcp_server` registry in `llm.db`, `Manager`
  (stdio `CommandTransport` + http `StreamableClientTransport`, tool cache,
  `{{secret:}}` env via Vault, least-env spawn, 32 KB result cap),
  `/mcp/servers*` + `/mcp/tools`, `capabilities.mcp`, AI Hub **"MCP"** tab
  (`McpView`/`McpServerDialog`). No LLM wiring yet. **A4b done 2026-09-01**:
  `ChatRequest.Tools`/`ToolCall`/`ChatResult`, tool mapping in all 4 adapters
  (openai streamed `tool_calls` reassembly, ollama, anthropic `tool_use`
  blocks, gemini `functionCall`), agent loop in `engine.go` `stream()` (max 6
  iters, `ToolRunner` iface + `mcpToolRunner` in main.go), SSE
  `tool-call`/`tool-result`, `?tools=all|<ids>` on chat + task streams, FE
  Playground "Tools" toggle + `<ToolSteps>`. **A4c done 2026-09-01**:
  `ToolDef.ReadOnly` (from MCP `readOnlyHint`) — read-only tools auto-run,
  others pause on a `tool-approval` SSE event and wait on
  `POST /llm/tool/{id}/resume {approved}` (`Engine.ResumeTool`, 5-min timeout
  → deny); declined result still fed back so the model reacts. FE: amber
  Approve/Deny row in `<ToolSteps>`, `llmStore.resumeToolCall`. **A4d done
  2026-09-01**: `Task.Tools []string` (server ids / `["all"]`),
  `TaskRunStream` merges it, `TaskDialog` "MCP tools" checkboxes, `useLlm`
  tracks `steps[]` + `resume()`, `<AiPanel>` renders `<ToolSteps>` in both
  modes. Built-ins ship tool-free; user opts a task in. **A4e deferred**
  (tool transcript in saved convos, cost accounting, `list_changed` refresh).
  Lets the model look up commands/docs not in its training (Context7, web
  search). Note: Knowledge Hub's `McpServersScreen` is just a link list,
  unrelated.
### Settings module (started 2026-08-31, S0–S2 done)

`/settings` page (`adapters/ui/settings/`) — replaces the old rearrange-only
`ModuleSettingsDialog` (deleted). Left menu of sections from a
`SETTINGS_SECTIONS` registry (`registry.tsx`); a module with settings adds one
entry + its panel, no edit to `SettingsScaffold`. Plan +
phases: [`SETTINGS_MODULE_PLAN.md`](SETTINGS_MODULE_PLAN.md).

- **S0 done**: scaffold + routes (`/settings`, `/settings/:section`), rail gear
  → `navigate('/settings')`. Sections: **General** (theme, expanded-sidebar,
  module reorder/hide — dnd list ported from the old dialog), **Backend**
  (`backendStore` status/version + Reconnect + live capabilities), **About**.
- **S1 done**: AI section — `GET/PUT /llm/settings` (default connection / model
  / temperature), `Task.preferredConnectionId`/`preferredModel`, per-feature
  system prompts grouped by `TASK_GROUPS` prefix (reuses the extracted
  `adapters/ui/ai/TaskDialog`), `AiPanel` resolution chain (localStorage pick →
  task preferred → global default → first connection).
- **S2 done**: Runbooks section (`runbook_settings` retention/keep/concurrency/
  vault-autolock — `api.ApplyRunbookSettings` pushes concurrency +
  vault-autolock onto live objects at startup and on every write;
  `Engine.SetMaxConcurrent` new) + Network section (`NetworkSettingsDialog`
  body moved in, the dialog deleted, the module's "Toolkit settings" button
  deep-links to `/settings/network`).
- **S3 deferred**: export/import all settings, keyboard-shortcut editor,
  per-section reset, settings search, cross-device sync.
- Shared config → backend (`llm_settings` / `runbook_settings`); local
  (theme, module order, network blob) → client `IStoragePort`.

### Shared error handling (started 2026-08-31, E0–E2 done)

One classify-and-present system for backend/transport failures across every
module. Plan: [`ERROR_HANDLING_PLAN.md`](ERROR_HANDLING_PLAN.md).

- **Backend** `internal/apierr` — coded `Error{code,error,hint,status}`
  (closed code set: `auth_failed`/`unreachable`/`timeout`/`rate_limited`/
  `not_found`/`conflict`/`validation`/`locked`/`permission`/`upstream`/
  `internal`), constructors + `Write(w, err)` + `ClassifyHTTP`/`ClassifyNet`
  (upstream provider status / dial error → code). SSE errors ride the `error`
  event as `{error,code?,hint?}` (`sse.RejectCoded`; `llm.Engine` `errData`).
  A new endpoint returns `apierr.Write(w, apierr.Validation("…"))`, not a bare
  `{error}` string.
- **Frontend** `core/errors/appError.ts` — framework-free `AppErr extends
  Error` + `classify(raw, source)` (existing AppErr · `BackendUnavailableError`
  · `AbortError` · `TypeError` "failed to fetch" · `{error,code,hint}`
  envelope · plain Error/string). `PRESETS` give each code a title / hint /
  retryable / sticky. `stores/errorStore.ts` — `reportError(raw, 'Module')`
  (dedup 4s, cap 8, drops aborted); `window.unhandledrejection` auto-reports.
- **UI** `adapters/ui/errors/` — `<ErrorToaster/>` (in `AppShellScaffold`,
  bottom-right, sticky for auth/internal/backend_down else 6s), `<InlineError
  error onRetry?/>` over shadcn `alert`, `<ErrorIcon code/>`.
- **`backendClient`** already throws `AppErr` on every non-2xx + transport
  failure — a new module just lets it throw and calls `reportError` on
  mutation failures (or renders `<InlineError>` where a pane owns the error).
- **Covered so far**: all `/llm/*` + the 4 provider adapters (E1), `/vault/*`,
  `/runbooks/*` run/nodes/schedules/publish, `/hosts` + `/firewall/change`
  (E2). **E3 planned** (`ERROR_HANDLING_PLAN.md` §E3): E3a retry-from-toast,
  E3b error-history drawer, E3c migrate the other ~70 endpoints, E3d
  wording/i18n scaffold, E3e per-source rate-limit.

### Next-work plans (written 2026-09-01, none started)

Five phased plans queued; order TBD:

- **[`PACKAGING_PLAN.md`](PACKAGING_PLAN.md)** — Phase 7. Config hygiene
  (npm→bun in `tauri.conf.json`, version drift, default-Tauri icons, CSP) →
  sidecar build wired into `tauri build` → capability least-privilege audit →
  NSIS installer → manual install/launch/uninstall gate → web static deploy →
  Linux best-effort → release CI.
- **[`CODE_SPLITTING_PLAN.md`](CODE_SPLITTING_PLAN.md)** — entry chunk is
  989 KB gzip (one eager chunk). CS0 vendor split + treemap → CS1 router
  `lazy:` per `/tools/*` route → CS2 heavy-lib isolation (`pdf-lib`,
  `jsrsasign`, …) → CS3 hover-prefetch → CS4 CI budget guard. Target ≤ 350 KB
  gzip first-load.
- **`AI_MODULE_PLAN.md` §A3** — A3a tool/function-calling passthrough (no
  agent loop in the engine), A3b opt-in conversation history (`llm_conversation`
  /`llm_message`), A3c token/cost aggregation, A3d embeddings (gated on a
  consumer), A3e reliability polish.
- **`SETTINGS_MODULE_PLAN.md` §S3** — S3a per-section reset, S3b export/import
  all settings (no secrets), S3c settings search, S3d keyboard-shortcut
  editor, S3e cross-device sync (deferred — needs account layer), S3f
  web-build backend endpoint override.

### Utility-tool "power mode" endpoints (added 2026-08-27)

A handful of the 44 client-only tools now have an **optional** backend upgrade —
see [`TOOL_STRATEGY_REVIEW.md`](TOOL_STRATEGY_REVIEW.md). The browser path is
unchanged and still works with no backend; these light up only when the sidecar
/ service is present, gated through `adapters/backend/useOptionalBackend.ts`
(same capability map as the network tools). Endpoints, all non-history:
`POST /ssh-keygen` (Go stdlib RSA/ECDSA/passphrase keys), `/pdf/inspect` +
`/pdf/transform` (`pdfcpu` — validate/optimize/encrypt/decrypt), `/config/validate`
(`nginx -t` / `sshd -t` / `nft -c` / … check-only, never applies), `/qr/decode`
(`gozxing`), `/x509/fetch` (`tls.Dial` a live `host:443`). New Go deps:
`pdfcpu` (Apache-2.0), `makiuchi-d/gozxing` (MIT), `golang.org/x/crypto`,
`golang.org/x/image` — all pass the license gate as libraries.

### How to implement a network tool — three tiers, cheapest first

1. **Pure-Go library** when a solid one exists (`miekg/dns`, `gosnmp`, `beevik/ntp`,
   `prometheus-community/pro-bing`). Preferred.
2. **An OS built-in tool in structured-output mode** — `Get-NetNeighbor | ConvertTo-Json`,
   `ip -j neigh`, `nft -j list ruleset`, `pktmon`, `tracert`. Zero bundle, zero license
   question, always present. **Always take the `-j` / `--json` / `ConvertTo-Json` path so
   the parser is a typed `json.Unmarshal`, never text scraping** (`internal/cmdtool.RunJSON`
   is the exec-and-unmarshal helper — it is *not* a framework; each tool stays its own
   `internal/tools/<tool>/` package).
3. **Bundle a third-party binary** only when neither of the above works and the protocol is
   gnarly (`iperf3`). Exec + parse `--json`. See the license rule below.

Hand-rolled per-OS syscalls (`IcmpSendEcho`, `GetIpNetTable2`) are the last resort — only
where nothing else works unprivileged.

### Bundled-binary license rule

A third-party binary may be **bundled in the installer only if its license is MIT or
equivalently permissive: BSD-2/3-Clause, ISC, Apache-2.0, MPL-2.0.** (Attribution +
license-text file is then the only obligation.)

- **GPL / LGPL** — never bundled. Exec-ing a separate GPL binary is legally "mere
  aggregation" and does not infect the app, but it still forces a written source offer.
  If a GPL tool is genuinely the best (`mtr`), ship it as **optional, PATH-detected,
  user-installed** — not in the installer.
- **NPSL (nmap)** — restrictive redistribution + commercial clauses. Not used. For
  SYN-scan-class features use `naabu` (ProjectDiscovery, MIT).
- Every bundled binary is recorded in [`vendor-tools/TOOLS.md`](vendor-tools/TOOLS.md):
  name, version, SPDX license, SHA-256, upstream URL, and why-not-a-library.
  `vendor-tools/fetch-tools.sh` (or `.ps1`) downloads + verifies; `build-sidecar` copies
  the verified binaries next to the backend as `<tool>-<triple>`.

## Commands (run from `app/`)

```bash
bun install              # install deps
bun run dev               # Vite dev server (web) — http://localhost:1420
bun run tauri dev         # Tauri desktop dev (wraps the same Vite dev server)
bun run build              # static web build (tsc -b && vite build)
bun run tauri build        # desktop installer (MSI/NSIS via Tauri bundler)
bun run test                # Vitest, core logic unit tests
bun run check:bundle        # CS4 first-load gzip budget guard (after build)
bun run set-version <x>     # write the version into all 3 files (no arg = drift check)
bunx shadcn@latest add <x>  # add a shadcn/ui component
```

CI: `.github/workflows/frontend.yml` (lint + test + build + `check:bundle` +
version-drift, on `app/**`), `backend.yml`, `links.yml`.

Backend (run from `backend/`):

```bash
go test ./...                       # backend unit tests
go run ./cmd/infrakit-backend       # run the service (prints LISTENING + TOKEN)
./build-sidecar.sh                   # cross-compile into app/src-tauri/binaries/
                                     # (or, from app/:  bun run build:sidecar)
```

## Commit workflow

Solo, local-first. **Commit straight to `main` — no feature branch.** Never `git
push` unless explicitly asked.

- **One logical change per commit** (not one file, not one session). If the subject
  needs an "and", it's probably two commits. Each commit must **build and pass
  tests on its own** — bundle tightly-coupled work (e.g. a module's P1–P3 that
  share scaffolding) rather than land pieces that don't compile alone.
- **Green gate before every commit** — never commit red:
  ```bash
  cd app && bun run build && bun run test && bun run lint      # frontend
  cd backend && go vet ./... && go test ./...                   # if backend touched
  ```
  Half-done work stays in the working tree (or `git stash`), never a red commit.
- **Commit at each green checkpoint, before starting the next feature** — gives a
  clean diff for the next change and a safe rollback point (`git reset --hard
  HEAD` / `git checkout .`) before the next edits land.
- Multi-phase work: commit per phase when phases are individually shippable
  (Network N0…N3), else bundle. Plan docs say "commit after every checkpoint
  bullet" — follow that.
- **Message**: conventional-ish subject saying *what* changed; body for non-obvious
  decisions + test status. End with:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
- No PR review catches a bad commit here — **green + small + clear message** is the
  only safety net.

## Working conventions

- Keep `src/core/**` framework-free — this is the part every future backend/frontend
  swap (there's been one already) needs to survive untouched.
- Match `design.md`'s existing rules where they're UI-framework-agnostic (e.g. the
  "selected-state must come from one shared token, never a one-off color" rule) —
  translate the *rule*, not the Flutter code, into the shadcn/Tailwind equivalent.
- Don't start the Go backend phase opportunistically while porting tools — it's a
  separate, later phase (see `MIGRATION_PLAN.md`). Keep the frontend client-only until
  that phase is explicitly started, same constraint the original spec had (§5).
