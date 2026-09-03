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
- **A3b done 2026-09-01** (`d585805`): opt-in conversation history —
  `internal/llm/history.go` (`History` on shared `llm.db`,
  `llm_conversation`+`llm_message`, `steps` blob kept), `/llm/conversations`
  CRUD, Playground left rail + Save + Auto-save toggle. Client owns the
  transcript + POSTs it; nothing saved unless the user opts in. **A3c**
  (token in/out totals, NO cost — owner cut pricing), **A3d** (embeddings, on
  demand), **A3e** (reliability) still planned. **A4 = MCP tools + tool-calling** — own plan
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
  modes. Built-ins ship tool-free; user opts a task in. **A4e done
  2026-09-01** (`e690581`/`2ff4522`/`455bc8a`): `list_changed` cache drop ·
  tool transcript + token totals in saved chats · per-server `ServerStatus`
  (connected/toolCount/lastError) in McpView. **A4 complete.** **A4f done
  2026-09-01** (`a7a1cf5`/`1543929`/`34557de`/`79e050a`,
  [`MCP_RESOURCES_PROMPTS_PLAN.md`](MCP_RESOURCES_PROMPTS_PLAN.md)): MCP
  *resources* + *prompts* — `internal/mcp` gains `Resources`/`ReadResource`/
  `Prompts`/`GetPrompt` (+ `rpAt` 60s cache, Resource/Prompt `list_changed`
  handlers, `ServerStatus` resource/prompt counts, `dial` test seam); 4
  endpoints (`/mcp/resources`, `/mcp/resources/read`, `/mcp/prompts`,
  `/mcp/prompts/get`). FE: `ContextPickerDialog` ("Context" in Playground +
  Paperclip in `<AiPanel>` — attach a resource as a user context message,
  32KiB/resource cap) + `PromptPickerDialog` (Playground "Prompts" → arg
  form → text into the draft). User-driven only; no approval gate (reads).
  Two Gemini tool-calling bugs fixed live: `geminiSchema()`
  strips `$schema`/`additionalProperties` from MCP schemas (`ddcc1dc`);
  `ToolCall.Signature` echoes Gemini's `thoughtSignature` (`5176918`).
  Lets the model look up commands/docs not in its training (Context7, web
  search). Note: Knowledge Hub's `McpServersScreen` is just a link list,
  unrelated.
### Settings module (started 2026-08-31, S0–S2 + S3a–S3d + S3f done)

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
- **S3a–S3d done** (2026-09-01): per-section reset (`SettingsResetButton`),
  export/import all settings (`settingsBackup.ts`, no secrets), nav search
  (`keywords` per section), keyboard-shortcut editor (`core/shortcuts/` +
  `useShortcut` + General rebind UI).
- **S3f done** (`2396bbf`): web-build backend endpoint override —
  `adapters/backend/endpointOverride.ts` (`localStorage`
  `infrakit:backend-endpoint` `{url,token}` beats `VITE_BACKEND_URL`),
  `resolveWebEndpoint()` in `backendClient`+`sseClient`, Settings → Backend
  "Endpoint override" group (web build only).
- **S3e killed**: cross-device sync — standalone app, no account layer.
- Shared config → backend (`llm_settings` / `runbook_settings`); local
  (theme, module order, network blob, endpoint override) → client
  `IStoragePort` / `localStorage`.

### Ansible Manager module (started 2026-09-02, AN0 done)

**Ansible** (`moduleTaxonomy.ts` id `ansible`, route `/tools/ansible`) — a
**backend-mandatory** dedicated module (its own T7 console, NOT a Runbooks
section) for running Ansible playbooks with a live play→task→host tree.
Plan + phases: [`ANSIBLE_MODULE_PLAN.md`](ANSIBLE_MODULE_PLAN.md)
(AN0–AN5, +AN6 deferred). Proposal:
[`ANSIBLE_MODULE_PROPOSAL.md`](ANSIBLE_MODULE_PROPOSAL.md).

- **Backend** `internal/ansible/` + new `ansible.db` (sibling of
  `orchestrator.db`, `--ansible-db` flag). **No new Go deps** — shells out
  to the user's `ansible*` on PATH (Tier 1) or an InfraKit-managed `uv`
  venv with `ansible-core` (Tier 2); `RuntimeMode` auto/system/managed,
  `EnsureManaged` streams `uv venv` + `uv pip install` over SSE.
- **Streaming event model**: a shipped Python callback plugin
  (`callback/infrakit_events.py`, `CALLBACK_TYPE=notification`,
  `NEEDS_ENABLED`) writes NDJSON to `$INFRAKIT_EVENT_FILE`; `embed.go`
  materializes it, `run.go`'s `Engine` tails the file and folds events
  into SSE (`run-start` / `ansible-*` / `stdout` / `stderr` / `run-end`).
  It is a data file, not a Go dependency; `ANSIBLE_CALLBACK_PLUGINS`
  points only at its dir.
- **Projects** = local folders. `Scaffold` writes a conventional layout;
  `ScanTree` finds playbooks (by YAML shape) / roles / collections /
  inventories. Owner-scoped + `ClaimOrphans` (U2). Playbook paths jailed
  with `safeJoin` (`filepath.Clean` + prefix check). Extra-vars → temp
  `-e @file`.
- **Endpoints**: `/ansible/settings` (+admin PUT), `/ansible/runtime/setup/stream`
  (SSE), `/ansible/projects[/{id}]` CRUD + `/tree`, `/ansible/projects/{id}/run/stream`
  (SSE), `/ansible/runs[/{id}]`. `capabilities.ansible`; `moduleOf` → `"ansible"`.
- **Frontend**: `src/core/ansible/**` (framework-free), `ansibleClient.ts`,
  `ansibleStore.ts` (thin cache + live-run tree fold). `adapters/ui/ansible/`
  — T7 `AnsibleConsoleScaffold` (own top nav + runtime strip),
  `RuntimePanel`, `ProjectsView` (list + New/Add-existing dialog + file
  tree + run form), `RunView` (bottom-sheet play→task→host tree, per-host
  OK/CHANGED/FAILED/SKIPPED/UNREACHABLE badges + console toggle + recap),
  `HistoryView`. Single-tool shell module (`hideToolPane`).
- **AN1 done** (`3f0222f`): `inventory.go` (`Engine.Inventory` →
  `ansible-inventory --list/--graph`, groups→hosts→vars); project-file
  read/write endpoint (`GET|PUT /ansible/projects/{id}/file?path=`,
  `SafeJoin`-jailed, 1 MiB cap); **Jobs** (`ansible_job` table, owner-scoped
  CRUD, `Job.Spec()`, `ansible_run.job_id` + ALTER migration,
  `/ansible/jobs[/{id}]` + `/jobs/{id}/run/stream`); FE `foldEvent()`
  reducer shared by the live stream + `replayEvents()` (rebuild a finished
  run's tree from its stored NDJSON blob); Inventory tab, Jobs tab,
  History-row → read-only replay, RunView Re-run. **Note: ansible's control
  node does not run on native Windows** (`check_blocking_io` WinError 87) —
  a green play/task/host tree needs Linux/WSL.
- **AN2 done** (`130bb01`): `run.go` `execRun()` extracted (shared
  record/spawn/tail/SSE core); `adhoc.go` (`RunAdhoc` — `ansible <pat> -m`
  with synthetic play+task so the tree renders); `doc.go`
  (`ansible-doc -j`); `check.go` (`--syntax-check` + `ansible-lint -f json`,
  lint gated on install). Endpoints `/ansible/adhoc/stream`,
  `/ansible/doc?module=`, `POST /ansible/projects/{id}/{syntax-check,lint}`.
  FE: **first CodeMirror 6 dep** (`codemirror` + `@codemirror/lang-yaml`,
  lazy — own 106 KB gz chunk, entry budget untouched); `CodeEditor.tsx`
  wrapper; Editor tab (file picker + editor + Save + Syntax check + Lint +
  `ansible-doc` sidebar); Ad-hoc tab.
- **AN3 done** (`8e794a5`): `galaxy.go` (no new Go deps) — `GalaxySearch`
  (galaxy.ansible.com v3 collections + v1 roles, client-side filtered),
  `Engine.GalaxyInstall` (`ansible-galaxy install` project-local, SSE;
  `name=""` = whole `requirements.yml`). Endpoints
  `/ansible/galaxy/search`, `/ansible/projects/{id}/galaxy/install/stream`.
  FE **Content tab** — `requirements.yml` CodeMirror editor + Galaxy
  search pane + Installed panel.
- **AN4 done** (`1dd3634`): `vault.go` (`Engine.Vault` — ansible-vault
  encrypt/decrypt/view/rekey, password = InfraKit Vault secret → 0600 temp
  `--vault-password-file`, `POST /ansible/projects/{id}/vault`);
  `Job.SurveySchema` + `JobRunStream ?extraVars=` override; `scheduler.go`
  + `ansible_schedule` table (cron-fire a Job, reuses `orchestrator.ParseCron`,
  30s poll, `/ansible/schedules` CRUD, `NewScheduler` in main.go);
  `internal/llm/task.go` builtins `ansible.gen-playbook` + `ansible.explain-task`.
  FE: Editor right sidebar Docs/Generate/Explain (`<AiPanel>`), Vault
  toolbar dialog (`SecretPicker` reused), SchedulesView tab, Job survey
  JSON field + run-time survey dialog, `taskGroups` `ansible.` group.
- **AN5 done** (`a65bd61`): `git.go` (`CloneRepo`/`PullRepo` via `git`
  binary — private https uses a Vault secret as `http.extraHeader` Bearer,
  SSH uses the agent; `mode "git"` on create + `POST /projects/{id}/pull`);
  multi-user **publish** (`POST /projects|jobs/{id}/publish`, visibility
  already owner-scoped) + **run approval gate** (`Job.RequiresApproval` →
  run parks `awaiting_approval`, `gate()` reuses the orchestrator's
  `awaitRunApproval`/`ResumeRun`/`ErrApproveSelf`; `/runs/pending-approvals`
  + `/runs/{id}/approve`); dynamic inventory = `ProjectFile` PUT chmods a
  shebang script under `inventory/` 0755. FE: Git mode in the New Project
  dialog, Pull/Publish buttons, per-job Publish + "requires approval",
  `ApprovalsView` tab (multi-user), RunView awaiting state. Scaffold now
  only forces Runtime when there's no workspace folder.
- **AN0–AN5 complete.** **AN6a + AN6b done** (`e889f5e`,
  [`ANSIBLE_RUNTIME_PLAN.md`](ANSIBLE_RUNTIME_PLAN.md)): `internal/ansible/runner.go`
  `Runner` interface (`Name`/`Probe`/`Command`/`TempDir`/`Setup`/`Teardown`) is
  now the module's one ansible* spawn point — all 7 exec sites route through
  `e.activeRunner(ctx).Command(...)`. `localRunner` = today's system/managed
  unchanged. `containerRunner` (`runner_container.go`) runs ansible in
  `docker`/`podman run` (`-v <project>:/infra-project` + tmp + callback mounts,
  Windows-backslash path rewrite, `ANSIBLE_CONFIG` past the world-writable
  guard); `Setup` builds `infrakit-ansible:local` from a generated Dockerfile
  (ansible-core + `controlNodePipPackages`/`Collections` from settings) or pulls
  an override. `/ansible/settings` gains `os`/`install`/`runners`/container
  fields; `/runtime/setup/stream?mode=` + `/runtime/teardown`. **Verified on
  Windows + Docker Desktop.** — **AN6c done** (`d1dbafd`): `runner_wsl.go` —
  run ansible in a WSL2 distro. `wslText` decodes `wsl.exe`'s UTF-16LE;
  `winToWSL` (`C:\X → /mnt/c/X`) rewrites the project dir + argv/env paths;
  `--cd` + `ANSIBLE_CONFIG` past the world-writable guard. `Setup` provisions a
  dedicated `InfraKit-Ansible` distro (`official:<name>` via `wsl --install`, or
  `wsl --import` a local `.tar` / a downloaded Canonical Ubuntu WSL rootfs —
  `download.go`, pinned in `vendor-tools/TOOLS.md`) then streamed `apt`+`pip3`
  install; `Teardown` = `wsl --unregister` (refuses non-dedicated distros).
  `wslDistro`/`wslSource` settings, `RuntimePanel` `wsl` card + `WslSetup`
  block. **Verified: point at the user's Ubuntu distro → run playbook →
  full play/task/host tree.** — **AN6e done** (`a08d1dd`): `Runner.ApplyDeps`
  + `depLists(settings)` — one `controlNodePipPackages`/`Collections` pair
  feeds every runner. `Runtime.EnsureManaged(pip, collections)` + `ApplyManagedDeps`
  (venv-only). container `ApplyDeps` = rebuild (layer cache); wsl = `pip3` +
  galaxy skipping apt. SSE `GET /ansible/runtime/deps/apply/stream?mode=`.
  FE: shared `DepsEditor` (managed/container/wsl) with Save + "Install deps now".
  **Verified: `jmespath` applied to the WSL distro with no reprovision.** —
  **AN6d done** (`ae20044`): `Runner` iface broadened `Command()→Stream()/Capture()`
  (SSH can't be an `*exec.Cmd`); `runner_ssh.go` — reuses the R2 SSH executor
  (`executor.SSHRun`/`SSHRunStdin`, new thin exports, no new dep),
  `Engine.SetNodeResolver` from the `ssh_node` registry + vault (main.go);
  `Stream` tars the project (+ callback plugin) → `~/.infrakit-ansible/<proj>`
  (or `remoteProjectPath`), ships `-e @tmp`/vault-pw 0600, runs
  `ansible-playbook` remotely with `tail -F` of the event file marked
  (`\x01EVT\x01`) back through the stream → split into the local file execRun
  tails, so the tree still streams; `Setup` installs ansible over SSH.
  `remoteNodeId`/`remoteWorkdir`/`remoteProjectPath` settings; RuntimePanel
  `remote` card + `RemoteSetup` (SSH-node picker). Structurally verified
  (Probe reaches the SSH handshake; helpers unit-tested; transport is R2's).
  — **AN6f** (fact-cache browser) is the last phase. Workflows **killed**. No new deps.

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
  (E2). **E3 COMPLETE** (`ERROR_HANDLING_PLAN.md` §E3): E3a retry-from-toast,
  E3b error-history drawer, E3c all ~70 endpoints migrated + `apierr.Unavailable()`
  + `backend.yml` grep guard, E3d `errorStrings.ts` i18n scaffold + wording
  pass, E3e per-source rate-limit.

### Roadmap status (2026-09-01)

`ROADMAP.md` — **all 15 numbered items + A4f + the user-management module
(U0–U6) done.** See it and the `*_PLAN.md` docs for detail. Landed since
2026-09-01: AI **A3b/A3c/A3e**, **A4e/A4f**, **E3** (complete),
**S3a–S3d + S3f**, **CS** jsrsasign→peculiar, and **user management**
([`USER_MANAGEMENT_PLAN.md`](USER_MANAGEMENT_PLAN.md)) — opt-in multi-tenant
auth (`--auth on`, **off by default — solo desktop byte-identical**),
per-user AI/vault/runbook/history data, server-side Prompt Library,
multi-user runbook approvals, admin audit log, self-signed TLS
(`--tls auto`) + fingerprint pinning + a hard non-loopback gate.
**Remaining = parked only**: Packaging P7e–P7h (owner-paused), A4f
`Task.resources` always-inject, the Tauri desktop custom-cert verifier
(U6 deferred), S3e sync (now buildable on the account layer, unpark on
request). **Killed**: A3d embeddings.

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
