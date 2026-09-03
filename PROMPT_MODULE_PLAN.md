# Prompt Library Module — Implementation Plan & Roadmap

Status: **planned, not started (2026-08-29).** No code yet. All design
decisions resolved (§9). This doc is the full spec for P1–P4; the LLM
Playground (P5) is deferred by design (§8).

Reference surface: futureagi.com's *Prompt* area (folder list, versioning,
system/user/assistant message list, `{{variables}}`, template gallery). We port
**only the prompt-library half** — no Playground / Evaluation / Metrics /
Simulation now.

---

## 1. Concept

A **personal library for authoring, versioning and reusing LLM prompts as
templates.** Write a prompt once, parameterise it with variables, keep its
version history, fill the variables, and copy the result — per message or all at
once — into whatever chat/agent UI you actually run.

- **Provider-agnostic.** A prompt is text + roles. No per-prompt model.
- **No LLM runtime in P1–P4.** Connecting Ollama / LM Studio / OpenAI-compatible
  / Anthropic / Gemini and running a prompt is P5 (§8). The data model and file
  layout leave a clean seam; **zero** execution/networking code is written
  before then, so there is nothing to tear down.
- **Client-only**, same as the other 44 tools. Persistence through the existing
  `IStoragePort` (localStorage on web, Tauri `fs` on desktop). No SQLite — the
  backend's SQLite is the deferred sidecar and pulling it in here would break
  the client-only constraint.

### 1.1 What a "prompt" is

An ordered list of **messages**, each with a **role**:

| Role | Meaning | In a template |
|------|---------|---------------|
| `system` | Instructions / persona / context. Not a conversational turn. | Usually the bulk of the prompt. May be empty. |
| `user` | A user turn — the question / task / trigger. | The parameterised request. May be empty. |
| `assistant` | A model turn. | **(a) Few-shot examples** — hand-written `user → assistant` pairs before the real user turn, demonstrating wanted format/style. **(b) Prefill** — a partial assistant reply the model continues from (Anthropic Messages supports a trailing assistant message; OpenAI-style chat APIs mostly don't). |

Messages repeat in any order: `system, user, assistant, user, assistant, …`. A
**new prompt** starts with one empty `system` + one empty `user`. The editor
footer adds more of any role.

### 1.2 Variables

- Syntax: **`{{VARIABLE_NAME}}`** (mustache). Detection regex:
  `\{\{\s*([A-Za-z0-9_]+)\s*\}\}`.
- **Auto-detected** by scanning every message body. The detected list (ordered
  by first appearance, de-duplicated) is the source of truth for *which*
  variables exist.
- Optional per-variable metadata, stored on the prompt as a
  `Record<name, VariableMeta>` map: `description`, `defaultValue`. Metadata for a
  variable that no longer appears in any message is **kept** (harmless; returns
  if the variable is re-added) but **not shown** in the Fill dialog — the
  Variables inspector shows it greyed with a "remove metadata" affordance.

### 1.3 Fill & Copy

Opened from the header or the Variables inspector. The core "get the prompt
out" flow.

- One text field per **detected** variable, prefilled from `defaultValue`.
- Live **rendered preview**: the message list with `{{VARS}}` substituted.
- Missing (unfilled, no default) variables render as literal `{{NAME}}` with a
  non-blocking "3 variables unfilled" warning (futureagi behaviour) — never
  blocks copy.
- **Per-message copy**: each rendered message is its own block with its own
  copy button — because in a real app the system prompt and the user prompt go
  into different boxes.
- **Copy all**: one button copies every message as a single string, with a
  **format toggle**:

  | Format | Output |
  |--------|--------|
  | **Plain text, labeled** *(default)* | 1 message → bare content. 2+ → each block prefixed `System:` / `User:` / `Assistant:` |
  | Markdown | same rule, `###` headers instead of `Label:` |
  | Messages JSON | `[{ "role": "...", "content": "..." }, …]` |
  | system + user | all `system` bodies joined by blank lines, then all `user` bodies; `assistant` dropped; no labels |

  Example (plain text, labeled, 2 messages):
  ```
  System:
  You are an SRE assistant. Be terse.

  User:
  Unit nginx.service on web-01 fails: <error output>
  ```

### 1.4 Organisation

- **Folders — one level only** (like futureagi: `All Prompts › Coding /
  Icon generation / Worksheet Gen`). A folder holds prompts, not sub-folders.
  Prompts with no folder show under a virtual **"Unfiled"** node.
  `Folder.parentId` stays in the model (always `null` for now) for a later
  "allow nesting" flip.
- **Tags** — freeform per-prompt labels (`chat`, `agent`, `troubleshooting`,
  `linux`, …). Free-text input with autocomplete from tags already used in the
  library + the seed tag set. No enforced vocabulary. The list filters by tag.
  This is what separates "template for a chat UI" from "template for an agent".
- **Search** — matches prompt **name + message body + tags**.

### 1.5 Versioning

- **Explicit Save** writes a new immutable version (`v1`, `v2`, …) with a UTC
  timestamp. A new prompt has **no versions** until its first Save (`v1`).
- **Draft** = edits since the last Save (or since creation). The draft
  **autosaves** to storage debounced (~800 ms) so nothing is lost on
  close/reload — but it does **not** create a version. Reopening a prompt with a
  draft shows a "you have unsaved changes" pill + a **Discard draft** action
  (reverts to latest version).
- Per-prompt version list, newest first. Selecting a non-latest version puts the
  editor **read-only** with a "viewing v2 — Restore to edit" banner.
- **Restore** loads an old version as the working draft; the next Save appends
  `v(N+1)`. History is never mutated.
- **Compare** — pick two versions → message-aligned diff (§3.3).
- **Per-version delete** — full snapshots are independent, so deleting one is a
  plain splice, no chain to repair. **Blocked** on the latest version and any
  **pinned** version. **Pin** is a per-version toggle.
- Version numbers are monotonic and never reused, even after a delete.
- Retention: keep all + manual delete. Auto-prune ("keep last N + pinned",
  mirrors Network's `PrunePolicy`) deferred until storage complains.

**Storage: full snapshots, not deltas.** Each version stores the complete
`messages[]`. A prompt with 20 versions × ~2 KB ≈ 40 KB, trivial against the
~5 MB localStorage budget. Diff is "compare two arrays" — no reconstruction.

### 1.6 Templates

- **Seed templates** ship as a **code data file** (like `cheatsheetContent.ts`
  / `EXTERNAL_RESOURCE_LINKS`) — read-only, easy to grow.
- **Depth: full worked prompts, not lean skeletons.** Each seed has a real
  method-driven system prompt (steps, ordering, output format, terseness rule).
  The **agent** seeds (§1.8 #8–#10) and any where output shape matters also get
  a **few-shot** `user → assistant` example pair. Contrast:

  *Lean skeleton (rejected):*
  ```
  System: You are a Linux troubleshooting assistant. Help diagnose why a
  systemd service won't start.
  User: Service {{UNIT}} on {{HOST}} ({{DISTRO}}) fails. Error: {{ERROR_OUTPUT}}
  ```

  *Full worked prompt (what we ship):*
  ```
  System: You are a senior SRE. Diagnose systemd service start failures
  methodically.
  - If not given, ask for `systemctl status <unit>`, `journalctl -xeu <unit>`,
    and the unit file.
  - Work the ladder: unit-file syntax → ExecStart path/binary → permissions →
    dependency ordering → resource limits → SELinux/AppArmor.
  - Give the single most likely cause first, then exact confirm + fix commands.
  - Terse. No preamble.
  User: Unit {{UNIT}} on {{HOST}} ({{DISTRO}}) fails. Error: {{ERROR_OUTPUT}}
  ```
- **Content workflow (decided)** — the 10 seeds are written directly into the
  data file during P3 with best judgment; the user edits them in-app afterward
  (using a template always clones it to an editable prompt).
- **User templates** — "Promote to template" copies a user prompt into a
  template slot in user storage. Seeds live in code, user templates in storage;
  the gallery merges both.

### 1.7 New-prompt flow

futureagi's two choices:

- **Start from scratch** — creates a draft-only prompt (1 empty system + 1 empty
  user) in the current folder. `v1` on first Save.
- **Start from a template** — opens the **template gallery** (search, grouped by
  tag, each card previews role composition + tags). "Use" **clones** the
  template into the current folder: a new prompt with `v1` already set to the
  template content, tags copied, name = template name, all `Message.id`s
  regenerated. User edits → draft → `v2`.

### 1.8 First 10 seed templates — IT troubleshooting

Tags carry the `chat` vs `agent` split plus domain. These deliberately overlap
InfraKit's own domains.

| # | Name | Roles | Tags | Variables (indicative) |
|---|------|-------|------|------------------------|
| 1 | Linux service won't start | system + user | `chat` `linux` `troubleshooting` | `UNIT` `HOST` `DISTRO` `ERROR_OUTPUT` |
| 2 | High load / slow server triage | system + user | `chat` `performance` `troubleshooting` | `HOST` `SYMPTOM` `TOP_OUTPUT` |
| 3 | Disk full emergency | system + user | `chat` `linux` `troubleshooting` | `HOST` `MOUNT` `DF_OUTPUT` |
| 4 | Network connectivity debug | system + user | `chat` `network` `troubleshooting` | `SOURCE` `DEST` `PORT` `SYMPTOM` |
| 5 | TLS / certificate error | system + user | `chat` `security` `troubleshooting` | `ENDPOINT` `ERROR_STRING` `CLIENT` |
| 6 | Container won't come up | system + user | `chat` `containers` `troubleshooting` | `RUNTIME` `IMAGE` `LOGS` `EVENTS` |
| 7 | Database connection exhaustion | system + user | `chat` `database` `troubleshooting` | `ENGINE` `MAX_CONN` `ERROR_OUTPUT` `APP_STACK` |
| 8 | Log analyzer agent | system + few-shot pair + user | `agent` `observability` | `LOG_BLOB` `CONTEXT` |
| 9 | Incident first-responder agent | system + few-shot pair + user | `agent` `incident` | `ALERT` `IMPACT` `RECENT_CHANGES` |
| 10 | Config-change reviewer agent | system + few-shot pair + user | `agent` `security` `review` | `CONFIG_KIND` `DIFF` `ENVIRONMENT` |

---

## 2. UI — the T6 "Library Workspace" archetype

The 5 existing scaffolds (T1 split · T2 balanced · T3 stepper · T4 network ·
T5 generator) don't fit a folder + editor + history workspace. Add a sixth,
`PromptLibraryScaffold`, from the same `ToolScaffoldHeader` /
`ToolScaffoldPanel` primitives so it stays visually consistent — exactly how
the Network module added T4.

Three panes (the "notes app" shape, and what futureagi uses):

```
┌────────────┬────────────────────────────────────────┬──────────────┐
│  TREE      │  PROMPT EDITOR                           │ INSPECTOR    │
│ 🔍 search  │  Name [Linux service won't start]        │  VERSIONS    │
│ [tag ▾]    │  tags: chat ✕  linux ✕  + add            │  ● draft ⚠   │
│            │  ┌ System ▾ ───────────── ⧉  ⋮  ⠿ ┐     │    v2  2d 📌 │
│ ▾ All      │  │ You are an SRE assistant. Be terse.│  │    v1  5d    │
│  Coding    │  └───────────────────────────────────┘  │  [Compare]   │
│  ▾ Infra   │  ┌ User ▾ ─────────────── ⧉  ⋮  ⠿ ┐     │              │
│   • Linux… │  │ Unit {{UNIT}} on {{HOST}} fails:   │  │  VARIABLES   │
│   • TLS …  │  │ {{ERROR_OUTPUT}}                   │  │  {{UNIT}}    │
│  Unfiled   │  └───────────────────────────────────┘  │  {{HOST}}    │
│   • …      │  [ + System ]  [ + User ]  [ + Assistant]│  {{ERROR…}}  │
│ + Prompt   │                                          │ [Fill & Copy]│
│ + Folder   │                                          │              │
├────────────┴────────────────────────────────────────┴──────────────┤
│ HEADER:  Save (→ v3)   ·   Fill & Copy   ·   Duplicate   ·   ⋮      │
└───────────────────────────────────────────────────────────────────┘
```

### 2.1 Left — Tree pane

Collapsible (like Network's `SavedTargetsPane`).

- Search box (name + body + tags).
- Tag-filter dropdown (multi-select; shows count per tag).
- Flat folder list; each folder expands to its prompts; a virtual **Unfiled**
  node for `folderId: null`.
- `+ Prompt` (opens the new-prompt flow §1.7), `+ Folder` (inline name input).
- Folder row `⋮`: rename, delete (delete asks: move prompts to Unfiled vs delete
  them).
- Prompt row shows name + a small "draft" dot if it has unsaved edits.
- dnd-kit (P4): drag a prompt onto a folder to move it; drag to reorder within a
  folder.

### 2.2 Centre — Editor

- Inline-editable **name**.
- **Tag** chip row + free-text add with autocomplete.
- Ordered **message cards** (`MessageCard.tsx`). Each card:
  - role `Select` (system / user / assistant),
  - auto-growing textarea; `{{VAR}}` occurrences get a subtle highlight,
  - **⧉ copy** — copies this message's **raw** (unfilled) content,
  - `⋮` menu — move up / move down / duplicate / delete,
  - `⠿` drag handle (P4).
- Footer: `+ System` · `+ User` · `+ Assistant` (append at end; user reorders).
- When a non-latest version is selected: whole editor read-only + "viewing v2 —
  Restore to edit" banner.
- Empty library / no selection → centre shows an empty state: "Create your first
  prompt" + "Browse templates".

### 2.3 Right — Inspector

Two stacked sections.

- **Versions** — list newest-first; a "draft ⚠" row on top when dirty; `📌` on
  pinned; each row: `vN · relative time · [pin] [delete] [restore]` (delete
  disabled on latest + pinned). Select two rows → **Compare** button → diff
  dialog. Clicking one row → read-only view of that version.
- **Variables** — the detected list; click a row to edit `description` /
  `defaultValue`; orphaned-metadata rows greyed with "remove". Primary
  **Fill & Copy** button.

### 2.4 Dialogs

- **FillAndCopyDialog** — §1.3. Field per detected variable · live rendered
  preview · per-message copy buttons · "Copy all" + format toggle (default
  *plain text, labeled*) · unfilled-count warning.
- **VersionCompareDialog** — message-aligned (§3.3), per-message line diff via
  the `diff` dep, "only differences" toggle. Same visual language as
  `RunComparePanel`.
- **NewPromptDialog** — *Start from scratch* / *Start from a template*.
- **TemplateGallery** — search, tag groups, role-composition preview, "Use"
  (clones §1.7).

### 2.5 Header actions

`Save` (label shows the next version number; disabled when not dirty),
`Fill & Copy`, `Duplicate`, overflow `⋮` — `Move to folder`, `Delete prompt`,
`Promote to template`, `Export prompt (JSON)`, (P4) `Import`.

### 2.6 Responsive

Below `lg`, the three panes collapse to a `Tabs` switch (Tree / Editor /
Inspector) — the same fallback the other scaffolds use for stacked mode.

---

## 3. Core logic (`src/core/prompt/**` — framework-free)

### 3.1 Model — `promptModel.ts`

```ts
export type Role = 'system' | 'user' | 'assistant'

export interface Message {
  id: string          // stable across edits; regenerated on clone/import
  role: Role
  content: string
}

export interface VariableMeta {
  description?: string
  defaultValue?: string
}

export interface PromptVersion {
  version: number        // 1-based, monotonic, never reused
  createdAt: number      // unix ms UTC
  messages: Message[]    // FULL snapshot
  note?: string
  pinned?: boolean       // pinned + latest can't be deleted
}

export interface Prompt {
  id: string
  name: string
  folderId: string | null
  tags: string[]
  order: number                       // manual order within a folder (P4 dnd); default = createdAt
  variables: Record<string, VariableMeta>   // metadata only; detection is by scan
  versions: PromptVersion[]           // append-only; may be spliced by delete
  draft: Message[] | null             // unsaved edits; null when clean
  createdAt: number
  updatedAt: number
}

export interface Folder {
  id: string
  name: string
  parentId: string | null   // always null for now (one-level)
  order: number
}
```

Helpers: `currentMessages(p)` = `p.draft ?? latestVersion(p)?.messages ?? []`;
`isDirty(p)` = `p.draft != null`; `latestVersion(p)`.

### 3.2 `variableExtractor.ts`

`extractVariables(messages: Message[]): string[]` — scan all `content`, return
names in first-appearance order, de-duplicated. `+ .test.ts`.

### 3.3 `promptDiff.ts`

`diffVersions(a: Message[], b: Message[]): MessageDiff[]` — align by
`Message.id`:

- id in both, content equal → `unchanged`
- id in both, content differs → `changed` + line diff (`diff` dep)
- id only in `a` → `removed`
- id only in `b` → `added`
- role change on the same id → `changed` (role shown in the header)

Positional fallback when ids don't overlap (e.g. comparing across an import).
`+ .test.ts`.

### 3.4 `promptRenderer.ts`

```ts
type CopyFormat = 'text' | 'markdown' | 'messages-json' | 'system-user'

// substitute {{VARS}}; unknown vars left literal
renderMessage(m: Message, values: Record<string,string>): string
renderAll(messages: Message[], values: Record<string,string>, fmt: CopyFormat): string
countUnfilled(messages: Message[], values: Record<string,string>): number
```

`text`: 1 message → bare; 2+ → `Role:\n<content>` blocks joined by blank lines.
`markdown`: `### Role\n\n<content>`. `messages-json`:
`JSON.stringify([{role,content}], null, 2)`. `system-user`: systems joined
`\n\n`, blank line, users joined `\n\n`; assistants dropped. `+ .test.ts`.

### 3.5 `ports/IPromptRepository.ts`

```ts
export interface IPromptRepository {
  loadLibrary(): Promise<{ folders: Folder[]; prompts: Prompt[] }>
  savePrompt(p: Prompt): Promise<void>          // upsert
  deletePrompt(id: string): Promise<void>
  saveFolder(f: Folder): Promise<void>
  deleteFolder(id: string, orphanTo: 'unfiled' | 'delete'): Promise<void>
  listUserTemplates(): Promise<SeedTemplate[]>
  saveUserTemplate(t: SeedTemplate): Promise<void>
  deleteUserTemplate(id: string): Promise<void>
}
```

### 3.6 `templates/`

- `index.ts` — `SeedTemplate` type, `TEMPLATE_PROMPTS: SeedTemplate[]`,
  `TEMPLATE_TAGS: string[]`. A `SeedTemplate` is `{ id, name, tags, messages,
  variables }` (no versions/folders).
- `itTroubleshooting.ts` — the 10 seeds (§1.8), written in P3.
- `templates.test.ts` — every seed: unique id, non-empty name, ≥1 message, every
  `{{VAR}}` used has a `variables` entry, tags non-empty.

### 3.7 `ai/` — LATER (P5), interfaces + data only, **no fetch code**

- `IModelConnectionPort.ts` — the exec interface, unimplemented.
- `modelProviders.ts` — provider enum + endpoint shapes as plain data.

Hex check: `grep -rl "from 'react" app/src/core/prompt` prints nothing.

---

## 4. Adapters

### 4.1 `src/adapters/storage/promptRepository.ts`

`IPromptRepository` on `IStoragePort` (via `createStoragePort()`) — mirrors
`schemaRepository.ts`'s index+entries scheme:

| Key | Value |
|-----|-------|
| `prompt_index` | JSON `{ folders: Folder[], promptIds: string[] }` |
| `prompt_<id>` | JSON of one `Prompt` (full `versions[]` + `draft`) |
| `prompt_user_templates` | JSON `SeedTemplate[]` |

`savePrompt` / `deletePrompt` keep `prompt_index.promptIds` and the per-prompt
entries in sync. Works unchanged on web (localStorage) and desktop (Tauri fs).
`+ promptRepository.test.ts` (round-trip, index sync, folder orphaning).

### 4.2 `src/stores/promptLibraryStore.ts` (zustand)

```
state:  folders, prompts, loaded
        selectedPromptId, viewingVersion (number | 'draft'),
        compareSelection: number[]        // up to 2
        treeCollapsed, activePane (mobile)
actions: hydrate()                        // repo.loadLibrary on mount
        createPrompt(fromTemplate?)  duplicatePrompt(id)  deletePrompt(id)
        renamePrompt  setTags  moveToFolder  setOrder
        editMessages(msgs)               // sets draft, debounced repo.savePrompt
        discardDraft(id)
        saveVersion(id, note?)           // draft → new PromptVersion, clears draft
        restoreVersion(id, n)  deleteVersion(id, n)  pinVersion(id, n, bool)
        promoteToTemplate(id)
        createFolder  renameFolder  deleteFolder
```

Debounced draft autosave lives in the store (~800 ms trailing). All writes go
through the repo, never straight to storage.

### 4.3 UI files — `src/adapters/ui/prompt/`

`PromptLibraryScaffold.tsx` · `PromptTreePane.tsx` · `PromptEditor.tsx` ·
`MessageCard.tsx` · `PromptInspector.tsx` · `VersionList.tsx` ·
`VariableList.tsx` · `FillAndCopyDialog.tsx` · `VersionCompareDialog.tsx` ·
`NewPromptDialog.tsx` · `TemplateGallery.tsx`.

`src/adapters/ui/tools/PromptLibraryScreen.tsx` — thin wrapper mounting the
scaffold + `hydrate()`, like the other Screen files.

### 4.4 Wiring

- `routes.tsx` — `{ path: 'tools/prompt-library', element: <PromptLibraryScreen /> }`
- `moduleTaxonomy.ts` — new module, placed after `knowledge` (or wherever the
  rail order wants it):
  ```ts
  {
    id: 'prompt',
    title: 'Prompt Library',
    icon: Library,   // lucide-react
    tools: [
      { id: 'prompt-library', name: 'Prompt Library',
        description: 'Author, version & reuse LLM prompt templates',
        icon: Library, route: '/tools/prompt-library' },
    ],
  }
  ```
  Single-tool **shell** module: `hideToolPane: true` on the `ModuleDef` — the
  rail opens `/tools/prompt-library` directly (via `moduleRailRoute`), the
  tool-list swap pane is suppressed, and `/modules/prompt` redirects to the
  tool. (FormFlow now also skips its one-card page via `moduleRailRoute` but
  keeps its pane for the saved-template rows.)

---

## 5. Phasing

Commit after each checkpoint. No LLM code before P5.

### P1 — Library core + CRUD + Fill & Copy (no versioning) — **DONE 2026-08-29**

Shipped: `src/core/prompt/` (`promptModel` · `variableExtractor` ·
`promptRenderer` · `ports/IPromptRepository` · `templates/index` stub, all
framework-free) + `adapters/storage/promptRepository.ts` +
`stores/promptLibraryStore.ts` (debounced ~800 ms message autosave, immediate
persist for structural changes) + `adapters/ui/prompt/` (7 components:
`PromptLibraryScaffold` T6 three-pane, `PromptTreePane`, `PromptEditor`,
`MessageCard`, `PromptInspector`, `FillAndCopyDialog`) +
`adapters/ui/tools/PromptLibraryScreen.tsx` + taxonomy module `prompt` + route
`/tools/prompt-library`. 23 new tests (1266 total green); `bun run build` +
`tsc -b` + lint clean; hex boundary intact. Verified in-browser: create →
add system/user/assistant → variable auto-detect → Fill & Copy live
substitution + all 4 formats + per-message copy → reload → byte-for-byte
restore → folder create/delete (both orphan modes, unit-tested). Inspector's
Versions section is a P2 placeholder.

<details><summary>original P1 checkpoint</summary>
- `promptModel` · `variableExtractor` · `promptRenderer` (+ tests)
- `IPromptRepository` + `promptRepository.ts` (+ tests)
- `promptLibraryStore` (hydrate, prompt/folder CRUD, `editMessages` with
  debounced autosave — but treat the whole prompt as a single mutable
  `messages[]` for now, stored under a temporary `draft`; no `versions[]` UI)
- taxonomy entry + route + `PromptLibraryScreen`
- `PromptLibraryScaffold` three-pane; `PromptTreePane` (folders + Unfiled, create
  / rename / delete, no dnd); `PromptEditor` + `MessageCard` (add / remove /
  reorder-by-`⋮` / per-message raw copy); tag row + tag filter; search
- `FillAndCopyDialog` — per-message + copy-all, all 4 formats
- empty states
- **DoD**: create folders + prompts, add system/user/assistant messages, tag,
  reorder, reload → byte-for-byte restore (incl. draft), Fill & Copy correct in
  every format, per-message copy works, hex boundary intact, `bun run build` +
  `bun run test` green. Verified in-browser.
</details>

### P2 — Versioning + compare + move-to-folder — **DONE 2026-08-29**

Shipped: `draft` is `null` when clean (editing back to the latest saved state
clears it); `Save · v{n}` header action; `VersionList` in the inspector —
read-only view of any version, restore-into-draft, pin, per-version delete
(blocked on latest + pinned), two-checkbox compare; `promptDiff.ts` (id-aligned,
word-level via `diffWordsWithSpace`, positional fallback) + `VersionCompareDialog`
(summary counts, "only differences", word-diff highlighting) + 7 tests;
"unsaved changes / draft not saved yet" pill with **Discard**. Templates and
duplicates land as `v1` immediately; empty prompts are saveable. **Also:** a
folder `Select` in the editor header — move any prompt between folders / back to
Unfiled (P4's dnd version still to come). 1273 tests green; build + lint clean.
Verified in-browser end-to-end (save → 2 versions → view v1 read-only → restore →
discard → compare with word diff → move to folder → reload → all persisted).

<details><summary>original P2 checkpoint</summary>

- promote the P1 "single messages[]" into `versions[]` + `draft` per §3.1
- `Save` header action → `saveVersion`; `v1` on first save; "next version" label
- `VersionList` — pin, delete (guard latest + pinned), restore, read-only view
- `promptDiff` (+ tests) · `VersionCompareDialog`
- draft "Discard" + "unsaved changes" pill
- **DoD**: N saves → N versions; delete v2 → v1/v3 intact & viewable; pinned +
  latest un-deletable; compare shows message add/remove/change + line diff;
  restore appends, never mutates; draft survives reload and Discard reverts.
</details>

### P3 — Templates — **DONE 2026-08-29**

Shipped: `templates/index.ts` (`mergeTemplates` / `templateTagList`) +
`itTroubleshooting.ts` — all 10 full worked seeds (§1.8), the 3 `agent` seeds
carrying a `user → assistant` few-shot pair; `templates.test.ts` (7 tests:
count, well-formedness, every `{{VAR}}` declared, agent few-shot present, merge
override, tag list). `NewPromptDialog` (scratch card + inline `TemplateGallery`)
+ `TemplateGallery` (search, tag chips, role-composition line, "Use template",
per-item remove for user templates). Store: `userTemplates` state (loaded in
`hydrate`), `promoteToTemplate`, `deleteUserTemplate`. `createPrompt({fromTemplate})`
clones as `v1` with regenerated message ids. Tree `+ Prompt` / folder `+` /
empty-state all open the dialog; header gained **Save as template**. 1279
tests green; build + lint clean. Verified in-browser: agent filter → 3 few-shot
seeds; clone → independent 4-message v1 with tags; promote → appears as a second
(removable) gallery card; remove works.

<details><summary>original P3 checkpoint</summary>

- `templates/index.ts` + `itTroubleshooting.ts` (the 10 full seeds, §1.8) + tests
- `NewPromptDialog` two-path · `TemplateGallery`
- clone-from-template → new prompt with `v1` = template, ids regenerated (§1.7)
- `promoteToTemplate` → `prompt_user_templates`; gallery merges seeds + user
- **DoD**: scratch and template paths both work; a cloned template is fully
  independent (edit doesn't touch the seed); a promoted prompt reappears in the
  gallery after reload; all 10 seeds pass the well-formedness test.
</details>

### P4 — Polish — **mostly DONE 2026-08-29**

Shipped:
- **dnd-kit** — drag message cards to reorder (grip handle, `PromptEditor`);
  drag prompts between folders + reorder within a folder (`PromptTreePane`:
  one `DndContext`, per-folder `SortableContext`, folder headers are
  `useDroppable` targets; `reorderInFolder` store action assigns `order`, tree
  now sorts by `order` not name).
- **Export / Import** — `core/prompt/promptIo.ts` (`exportPrompts` /
  `parsePromptExport` / `materializeImport`, all pure, 6 tests). Per-prompt
  export from the tree row; **Export all** / **Import** in the tree footer.
  Import drops all internal ids, matches folders by name, de-collides prompt
  names with " (imported)", validates the blob and reports failures.
- **Keyboard** — ⌘/Ctrl-S saves the dirty prompt, ⌘/Ctrl-↵ opens Fill & Copy
  (`PromptLibraryScaffold`, `preventDefault` so the browser's Save dialog stays
  out of the way).

1285 tests green; build + lint clean. Verified in-browser: Ctrl-S saves a new
version; drag handles render, dnd context mounts, no console errors; export/
import logic unit-tested. **Manual pass still needed:** an actual drag-drop
(synthetic pointer events don't reliably drive dnd-kit's PointerSensor —
same caveat class as `tauri dev`) and a real file-input import.

**Deferred:** responsive `Tabs` collapse `< lg` — the app is desktop-first
(design.md), other tools don't do it either; a fast-follow, not blocking P5.

### P4.5 — Typed variables + template import/export *(done 2026-09-03, `033e9dd` + polish)*

`VariableMeta` gained `kind` (`text | textarea | select | boolean | number`),
`options: VariableOption[]`, `allowCustom`, number `min/max/step`, and
`required` — every field optional, so existing prompts / seed templates /
export blobs stay valid without a version bump.

- **Fill & Copy** renders the control per `kind`: a `<Select>` of the option
  list (label shown, `value` substituted; optional `Custom…` free-text
  escape hatch when `allowCustom`), a Yes/No select, a bounded number input,
  or a textarea. `required` + empty blocks "Copy all" and per-message copy
  (hard error, not the soft amber "unfilled" count).
- **Inspector row** (`VariableMetaEditor`): a Type picker + per-kind
  controls + `required` toggle; collapsed row shows a kind badge.
- **Options authoring** (`VariableOptionsSheet`, new `ui/sheet.tsx` — Base UI
  `Dialog` anchored to the right edge): per-row value/label, `@dnd-kit`
  drag reorder (grip handle, keyboard sensor), bulk paste (`value | Label`
  per line, replace/append), 6 infra preset sets (`PRESET_OPTION_SETS` in
  `variableOptions.ts` — environments / log levels / OS families / severity
  / protocols / cloud), default-selection picker, allow-custom checkbox.
- **`sanitizeVariables` / `sanitizeVariableMeta`** coerce untrusted JSON on
  every import path; `promptIo` now runs variables through it.
- **User templates** get JSON export/import — `core/prompt/templateIo.ts`
  mirrors `promptIo.ts` (`exportTemplates` / `parseTemplateExport` /
  `materializeTemplateImport`, fresh ids, name de-collision, blob
  validation). Wired into `NewPromptDialog` / `TemplateGallery`: Import,
  Export all, per-card export. `kind` / `options` ride the blob.
- Base-UI `SelectValue` needs the function-child form to render a label
  instead of the raw value — used in all the new selects.

Tests: `variableOptions` (parser + presets), `promptModel` (sanitiser +
empty-check), `templateIo` (round-trip). 1332 green, hex boundary intact.
Verified in-browser: select/boolean kinds persist across reload, preset
seed, drag reorder, bulk paste, dropdown substitutes `value` / shows
`label`, `required` gate, template IO round-trip.

### P5 — LLM Playground *(deferred — separate effort, §8)*

---

## 6. Testing

Vitest, alongside each core file:

- `variableExtractor` — ordering, dedupe, malformed braces, unicode names
  rejected, `{{ SPACED }}` accepted
- `promptRenderer` — each format; 1-message bare vs 2+ labeled; unknown var left
  literal; `system-user` join semantics; `countUnfilled`
- `promptDiff` — added / removed / changed / unchanged; role change; positional
  fallback
- `promptRepository` — round-trip, index sync, folder delete both modes,
  version splice
- `templates` — well-formedness of all seeds

Target: parity with the repo norm (~30–40 new tests). Hex boundary check in CI.

---

## 7. Reused from existing code

| Need | Reuse |
|------|-------|
| Persistence | `IStoragePort` + `createStoragePort()` + the `schemaRepository.ts` index scheme |
| Line diff | `diff` dep + the approach in `src/core/utility/textDiff.ts` |
| Compare UI language | `adapters/ui/network/RunComparePanel.tsx` |
| Collapsible side pane | `adapters/ui/network/SavedTargetsPane.tsx` pattern |
| Scaffold primitives | `ToolScaffoldHeader` / `ToolScaffoldPanel` |
| dnd | `@dnd-kit/*` (already a dep, used by `ModuleSettingsDialog`) |
| Single-tool module wiring | the FormFlow module entry |

---

## 8. Deferred — P5 LLM Playground (roadmap, not this effort)

Listed so the seam is deliberate, not retrofitted.

- **Model connections** (app settings, not per-prompt): a list of
  `{ id, label, provider, baseUrl, apiKeyRef, model }`. Providers as data:
  - `openai-compatible` — `POST {baseUrl}/chat/completions` — LM Studio, Ollama's
    OpenAI endpoint, vLLM, OpenRouter, Groq, …
  - `anthropic` — Messages API (native trailing-assistant / prefill)
  - `gemini` — `generateContent`
- **Key storage** — ideally via the **Go backend** (Network module's sidecar
  pattern) so keys never enter the renderer; interim = `IStoragePort` with an
  explicit "plaintext on web" warning.
- **Playground tab** on a prompt — pick a connection · fill variables · **Run** →
  streamed output. Save runs against the prompt version by reusing the Network
  module's `RunEnvelope` + history-by-shape store (`resultShape: 'text'`).
- **Simulation / multi-turn** — send the message list as-is; append the model's
  reply as a new `assistant` message; continue.
- **Evaluation / Metrics** — out of scope, possibly permanently for a personal
  tool. The tab enum stays open.
- `src/core/prompt/ai/` holds interfaces + provider data only until then; the
  fetch/stream adapter lands in `adapters/ai/` or `adapters/backend/`.

---

## 9. Decisions (resolved 2026-08-29)

| # | Decision |
|---|----------|
| Name + icon | **"Prompt Library"**, lucide `Library` |
| Rail placement | **Own module** (`id: 'prompt'`), single tool inside |
| Variable syntax | **`{{VAR}}`** mustache, `\{\{\s*([A-Za-z0-9_]+)\s*\}\}` |
| Copy | **Per-message** copy buttons **and** "Copy all"; copy-all default = **plain text, labeled** (bare if 1 message) |
| Folders | **One level only**; `parentId` kept in model |
| Versioning | Full independent snapshots; keep all; **per-version manual delete** (latest + pinned protected) + pin toggle; monotonic numbers; auto-prune deferred; **no SQL**, no delta chain |
| Draft | **Persists** across reload (debounced autosave); explicit Save creates the version; "Discard draft" reverts to latest |
| Seed depth | **Full worked prompts**; few-shot pairs on the agent seeds; written directly in P3, user tweaks in-app |
| LLM runtime | **Deferred to P5**; `core/prompt/ai/` is interfaces + data only until then |

---

## 10. Open questions

None blocking. Flag during implementation if any surface.
