# Settings module — Design Proposal & Roadmap

Status: **proposal, not started (2026-08-31).** Core decisions resolved (§2).
App-shell work — replaces the rearrange-only `ModuleSettingsDialog` with a real
Settings page, and becomes the single home for config that is currently
scattered across stores, dialogs, and backend flags.

Reference: `AI_MODULE_PLAN.md` §9b raised this. The AI half is ~90 %
presentation over what A0/A1 already store.

---

## 1. Concept

One **Settings** surface: a full page with a left menu, reached from the rail's
gear. Each section owns one config domain. A module that has settings
contributes one section — mirrors the "how a module adds AI" recipe: no edit to
`SettingsScaffold` itself.

Vocabulary: Section (a left-menu entry) · Setting (one field) · scope
(`global` = backend, shared, headless-readable / `local` = client
`IStoragePort`, per-device).

---

## 2. Decisions (resolved 2026-08-31)

| # | Resolution |
|---|-----------|
| Entry point | The rail's gear **navigates to `/settings`** (no more dialog). `ModuleSettingsDialog` is deleted; its dnd module-reorder list moves into the **General** section. |
| Network settings | **Move into Settings** — the "Network" section is the single editor. The Network Toolkit keeps a small "Open settings" link that deep-links to `/settings/network`. `NetworkSettingsDialog` is retired. |
| Persistence split | **Shared → backend, local → client.** AI defaults + Runbooks retention/vault-autolock/concurrency → `llm_settings` / `runbook_settings` (survive a client-data clear, readable by a headless backend). Theme + module order/visibility + rail-expanded + the Network `NetworkSettings` blob → client `IStoragePort` (already there). |
| Per-task model | **Add now.** `Task.preferredConnectionId` / `preferredModel`. `AiPanel` fallback chain: localStorage pick → task preferred → global default. This *is* "per-module AI settings". |
| Not a `kModuleTaxonomy` entry | Settings is app-shell, not a tool module. Route lives in the shell layout; the gear is its only rail affordance. |
| Backend-optional | The Settings page works with **no backend** — backend-scoped sections show a "connect a backend to change this" state; local sections always work. |

---

## 3. Sections

| Section | Scope | Contents | Source today |
|---|---|---|---|
| **General** | local | theme (light/dark) · rail expanded default · **module order + hide/show** (dnd list) | `themeStore`, `moduleVisibilityStore` |
| **AI** | global + per-task | default connection / model / temperature · **per-feature system prompts** (task registry grouped by module) · each task's preferred connection/model · link to AI Hub → Connections | `llm_settings` (exists, no UI), `llm_task` overrides (A1) |
| **Runbooks** | global | history retention (days / max per runbook) · vault auto-lock minutes · max concurrent runs | `runbook_settings` + `--vault-autolock` / `--max-concurrent-runs` flags (need to become settings) |
| **Network** | local | proxy · custom DNS · default interface · timeouts/retries · geo provider + MaxMind key · history retention · IPv4 preference | `networkSettingsStore` (verbatim) |
| **Backend** | — | connection status · endpoint URL + token (web build only; desktop is sidecar-managed) · Reconnect · which capabilities are live | `backendStore` |
| **About** | — | app version, plan docs, licenses | `api.Version` |

---

## 4. Data model

### 4.1 Backend — new `llm_settings` keys (table already exists)

```
defaultConnectionId   string   // "" = first connection
defaultModel          string   // "" = connection default
defaultTemperature    string   // float as string, "" = provider default
```

Endpoints (new): `GET /llm/settings` → `{settings: {...}}`,
`PUT /llm/settings` → merge-write, returns the merged map. `llm.Store` already
has `GetSettings()` / `PutSetting()`.

### 4.2 Backend — `Task` gains

```go
PreferredConnectionID string `json:"preferredConnectionId,omitempty"`
PreferredModel        string `json:"preferredModel,omitempty"`
```

A built-in task carries no preference; setting one creates/updates the custom
override row (same as editing its template). Resolved by `ListTasks` /
`GetTask` like the rest of the task.

### 4.3 Backend — `runbook_settings` keys (table + endpoints exist from R0)

```
historyRetentionDays   (already read by the prune path)
historyMaxPerRunbook   (already read)
vaultAutoLockMinutes   (new — currently a process flag)
maxConcurrentRuns      (new — currently a process flag; a live change re-sizes the engine semaphore)
```

`--vault-autolock` / `--max-concurrent-runs` become **defaults**; a stored
value wins. `orchestrator.Engine` grows a `SetMaxConcurrent(n)`; `vault.Vault`
already has `SetAutoLock(d)`.

### 4.4 Frontend — `core/settings/`

```ts
export interface SettingsSectionDef {
  id: string
  label: string
  icon: LucideIcon
  scope: 'local' | 'global' | 'info'
  element: React.ReactNode
}
```

`adapters/ui/settings/registry.ts` exports `SETTINGS_SECTIONS:
SettingsSectionDef[]` — General, AI, Runbooks, Network, Backend, About. A new
module adds one entry + its panel component.

---

## 5. Frontend — the page

`adapters/ui/settings/SettingsScaffold.tsx` — **not** a T-scaffold. Plain
shell page: a `max-w` two-column layout, left menu (`SETTINGS_SECTIONS`),
right pane renders the active section. Route `/settings` (redirect →
`/settings/general`) and `/settings/:section` in the shell's `children`.

Sections: `GeneralSettings`, `AiSettings`, `RunbookSettings`,
`NetworkSettings` (the old dialog body, unchanged fields), `BackendSettings`,
`AboutSettings` — each in `adapters/ui/settings/sections/`.

### 5.1 AI section detail

- **Defaults** — a `SecretPicker`-style connection `Select` + a model `Select`
  (populated from that connection) + a temperature input. Writes
  `/llm/settings`.
- **Per-feature prompts** — the task list grouped:

  ```ts
  const TASK_GROUPS = [
    { prefix: 'prompt.',  label: 'Prompt Library' },
    { prefix: 'runbook.', label: 'Runbooks' },
    { prefix: 'command.', label: 'Shell & SSH' },
  ]
  ```

  Each task row: product label ("Improve prompt"), a preview of the system
  template, **Edit** (reuses `TasksView`'s `TaskDialog`), a per-task
  connection/model override, **Reset to built-in** when overridden. The AI Hub
  → Tasks tab stays as the raw/power view.

### 5.2 `AiPanel` / `useLlm` fallback chain

Model + connection resolution order, first hit wins:

1. `localStorage['infrakit:ai-panel:<taskId>']` (the user's last explicit pick)
2. `task.preferredConnectionId` / `task.preferredModel`
3. `llmSettings.defaultConnectionId` / `defaultModel`
4. first connection / its `defaultModel`

`llmStore` gains `settings` + `refreshSettings` + `putSettings`; `AiPanel`
reads it in the restore-pick effect.

### 5.3 Rail change

`AppSidebar` — the gear `<button>` inside `ModuleSettingsDialog` becomes a
`RailIcon`-style button: `onClick={() => navigate('/settings')}`,
`selected={pathname.startsWith('/settings')}`. `ModuleSettingsDialog` file
deleted.

---

## 6. Phasing

### S0 — Scaffold + General + Backend + About — **DONE 2026-08-31**
- `adapters/ui/settings/` — `registry.tsx` (`SETTINGS_SECTIONS` +
  `SettingsSectionDef`), `SettingsScaffold` (left menu + pane, with shared
  `SettingsGroup` / `SettingsRow` helpers), `SettingsScreen` wrapper. Routes
  `/settings` + `/settings/:section` in the shell layout. `core/settings/` not
  needed for S0 (nothing framework-free yet).
- **General** — `Switch` for dark theme + expanded-sidebar; the
  `ModuleSettingsDialog` `@dnd-kit` reorder/hide list ported verbatim into
  `ModuleOrderList`.
- **Backend** — `backendStore` status/version/host + Reconnect
  (`retry()`) + a live-capabilities chip list. (Runtime endpoint/token
  override for the web build → S3; the field is baked at build time today.)
- **About** — frontend/backend versions + the plan-doc list.
- Rail: the gear is now a `RailIcon` → `navigate('/settings')`,
  `selected` on `/settings*`. `ModuleSettingsDialog.tsx` deleted.
- **Verified in-browser**: gear opens `/settings` from any module; theme +
  expanded-sidebar toggles apply live; Reconnect shows "connected · dev · 24/26
  endpoints"; fresh-tab load zero console errors. Green: build + 1299 tests +
  lint (no new warnings).

### S1 — AI section — **DONE 2026-08-31**
- Backend: `GET/PUT /llm/settings` (merge-write; `defaultConnectionId` /
  `defaultModel` / `defaultTemperature`), `Task.PreferredConnectionID` /
  `PreferredModel` (custom-override fields). 2 new tests.
- Frontend: `LlmSettings` type, `llmStore.settings` +
  `refreshSettings`/`putSettings`, `getLlmSettings`/`putLlmSettings` client.
  `TaskDialog` extracted from `TasksView` to its own file + preferred
  connection/model selects. New `AiSettings` section: a Defaults form
  (connection → model → temperature) + the task registry grouped by
  `TASK_GROUPS` prefix (`prompt.` / `runbook.` / `command.`), each row
  Customise / Reset / shows its preferred model. Backend-unavailable → a
  "connect a backend" state.
- `AiPanel` resolution chain (fills connId + model independently, only while
  empty, so a late `settings` still lands): localStorage pick → task preferred
  → global default → first connection.
- **Verified in-browser**: `/settings/ai` Defaults form persisted a connection
  + model to `/llm/settings`; with localStorage cleared, a fresh "Explain
  command" `AiPanel` opened pre-selected on the global default
  (`Local Ollama` / `gemma4:e2b`); fresh-tab zero console errors. Green.

### S2 — Runbooks + Network sections — **DONE 2026-08-31**
- Backend: `orchestrator.Engine.SetMaxConcurrent(n)` (RW-mutex-guarded sem
  swap; in-flight runs keep their captured slot). `api.ApplyRunbookSettings
  (settings, engine, vault)` — pushes `maxConcurrentRuns` →
  `Engine.SetMaxConcurrent` and `vaultAutoLockMinutes` → `vault.SetAutoLock`;
  called at startup (after the process flags, so stored values win) and after
  every `PUT /runbook-settings`. `RunbookHandlers` gained `Vault`. 1 new test.
- Frontend: **Runbooks** section — retention / keep-per-runbook / max-
  concurrent / vault-autolock, loaded + committed on blur via the existing
  `/runbook-settings` endpoints. **Network** section = the old
  `NetworkSettingsDialog` body verbatim (`useNetworkSettingsStore`) + a
  "Reset to defaults". `NetworkSettingsDialog.tsx` deleted; the Network
  module's "Toolkit settings" button now `navigate('/settings/network')`.
- **Verified in-browser**: `/settings/runbooks` loaded 90/20/4/15, a retention
  edit persisted to `/runbook-settings`; a `vaultAutoLockMinutes` write live-
  applied (`vault/status.autoLockTotalSec` → 600); `/settings/network` renders
  the full form; the module deep-link lands on it; fresh tab zero console
  errors. Green: build + 1299 tests + lint (1 new accepted set-state-in-
  effect); go vet + go test ./... .

### S3 — Convenience & completeness — **planned, not started (2026-09-01)**

Small, mostly-frontend. Order below is by value; each is one commit.

#### S3a — Per-section reset — **DONE 2026-09-01** (`66f9f18`)
- `SettingsResetButton` — a shared two-click-confirm control (no dialog, no
  registry change); each section drops it at the bottom of its panel.
- General → `themeStore.reset` + `moduleVisibilityStore.reset` (dark, default
  order, nothing hidden, rail collapsed). Runbooks → `PUT /runbook-settings`
  with `DEFAULTS`. AI → clear the 3 `llm_settings` keys + `resetTask` every
  overridden task. Network → kept its existing "Reset to defaults".
- Simpler than the planned `SettingsSectionDef.onReset` — the button lives in
  the section component, not the scaffold.

#### S3b — Export / import all settings
- `core/settings/settingsIo.ts` (framework-free) — a versioned envelope
  `{ version, exportedAt, local: {...}, backend: {...} }`.
- Export: read every local store + `GET /llm/settings` + `GET
  /runbook-settings` + custom `llm_task` rows → one JSON download.
- Import: validate `version`, show a diff-ish summary ("theme, 4 module
  positions, 2 AI prompts, Runbooks retention"), apply on confirm — local
  stores directly, backend via the existing `PUT` endpoints.
- Secrets (`vault.enc`) are **never** in this file — it already has its own
  export (`/vault/export`). Connection API keys live in the vault → not
  exported here either; connections export as metadata only.
**DoD**: export on machine A, import on a fresh profile → theme + module
layout + AI prompts + Runbooks numbers all match; no secret material in the
file (grep the export in the test).

#### S3c — Settings search
- Build a static index at module load from the `SETTINGS_SECTIONS` registry —
  each section contributes `{ label, keywords[] }` (and ideally per-field
  labels).
- A search box above the left menu filters the menu + deep-links to
  `/settings/{section}` (and, stretch, scrolls to / highlights the field via
  an anchor).
**DoD**: typing "concurrency" jumps to Runbooks; "prompt" surfaces AI.

#### S3d — Keyboard-shortcut editor
- Today ⌘S / ⌘↵ are hard-coded in Prompt Library + Runbooks editors.
- `core/shortcuts/` — a registry of `{ id, label, defaultCombo, scope }` +
  a `useShortcut(id, handler)` hook reading overrides from a local store.
- A **General → Shortcuts** subsection: list, click-to-rebind, reset.
- Migrate the existing hard-coded handlers to `useShortcut`.
**DoD**: rebind "Save" to ⌘⇧S in the editor, it works, survives reload;
conflict detection warns on a dup combo.

#### S3e — Cross-device sync — **stays deferred**
Needs the account / auth layer that doesn't exist. When it does: the S3b
envelope is the payload; sync = push/pull it to a user endpoint with
last-write-wins + a manual conflict view.

#### S3f — Web-build backend endpoint override
Noted at §… (the `VITE_BACKEND_URL` field is build-time-baked today). A
Settings → Backend field (web build only) writing to `localStorage`, read by
`backendClient`/`sseClient` `resolve()` before the env fallback. Pairs with
`PACKAGING_PLAN.md` P7f.
**DoD**: set a URL in the field on the static build → tools connect without a
rebuild.

---

## 7. Reused from existing code

| Need | Reuse |
|------|-------|
| Module reorder dnd | `ModuleSettingsDialog`'s `@dnd-kit` list — moved, not rewritten |
| Local persist | `moduleVisibilityStore` / `themeStore` / `networkSettingsStore` patterns (`persist` + `storagePortAsZustandStorage`) |
| Backend settings | `llm.Store` + `orchestrator.Store` `GetSettings`/`PutSetting`; `/runbook-settings` endpoints exist |
| Task editor | `adapters/ui/ai/TasksView`'s `TaskDialog` |
| Connection/model pickers | `adapters/ui/ai/` `AiPanel` picker markup |
| Backend status | `backendStore` |
| Shell routing | the `AppShellScaffold` `children` route array |

---

## 8. Answering the framing question

- **"convert settings like a module with its own page + menu"** → §5: a
  `/settings` shell page, `SETTINGS_SECTIONS` registry, left menu.
- **"adjust AI settings, global or per-module (system prompt)"** → §5.1:
  global defaults in `llm_settings`; per-module = the task registry grouped by
  id-prefix, editing the existing custom-override rows; per-task preferred
  connection/model added in S1.
- **"where in the plan"** → its own doc, sequenced **after AI A2** (done),
  **before AI A3**.
