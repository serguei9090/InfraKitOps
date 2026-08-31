# AI module — Design Proposal & Roadmap

Status: **proposal, not started (2026-08-31).** Core decisions resolved (§2).
This supersedes the interfaces-only `src/core/prompt/ai/` stub and delivers the
work deferred as "Prompt Library P5" and "Runbooks R4 AI Assistant".

Reference: the CLAUDE.md stack note — "LLM runtime (playground / connect
Ollama·LM Studio·OpenAI·Anthropic·Gemini)". The Runbooks module's backend
(`chi` + per-launch bearer token + SSE + Vault) is the template.

---

## 1. Concept & vocabulary

One **central LLM layer** every module talks to instead of each module wiring
its own AI. Vocabulary:

| Term | Meaning |
|------|---------|
| **Provider** | An adapter for one API shape: `ollama`, `openai-compatible`, `anthropic`, `gemini`. |
| **Connection** | A configured endpoint: provider kind + base URL + default model + (optional) Vault secret holding the key. What the user sets up once. |
| **Model** | A model id available at a connection (`llama3.1:8b`, `gpt-4o`, …), pulled live from the provider. |
| **Task** | A named, grounded unit of work: an `id` (`prompt.improve`, `command.explain`), a system-prompt template with `{{context.*}}` slots, an input schema, and an output shape (`text` / `diff` / `json`). This is the **grounding connector**. |
| **Run** | One execution of a task (or a raw chat) against a connection+model, streamed over SSE. |

**The reuse mechanism**: a module adds AI by (a) registering a Task and
(b) dropping in `<AiPanel taskId="…" context={selection} />`. No change to the
central layer, no change to `App`. Mirrors CLAUDE.md's "adding a new tool is a
small mechanical change" rule.

---

## 2. Decisions (resolved 2026-08-31)

| # | Resolution |
|---|-----------|
| Storage | **Own `llm.db`** (pure-Go SQLite, sibling of `history.db` / `orchestrator.db`). The AI layer is cross-cutting — it does not live inside any one module's DB. |
| A0 providers | **`ollama` + `openai-compatible`.** `openai-compatible` + a base URL reaches LM Studio, vLLM, LocalAI, OpenAI, OpenRouter, Groq. Native `anthropic` + `gemini` land in A2. |
| Surface | **Rail module + playground.** Own rail entry: Playground · Connections · Tasks. Single-tool shell module (`hideToolPane`), T7 "Console Workspace" scaffold (top nav, like Runbooks). Proposed name **"AI Hub"**, id `ai`, route `/tools/ai` — overridable. |
| Tasks | **Hybrid.** Built-in tasks defined in Go (versioned with the module, always present, cannot be deleted). Custom tasks are editable rows in `llm.db`. A built-in task can be overridden by a custom task of the same id; "reset" drops the override. |
| Backend | **Mandatory for the whole module** (provider calls, key safety, CORS, SSE) — same as Runbooks. Web build with no backend shows the connect state. |
| Credentials | **Reuse the Vault.** `Connection.authSecretId` → a Vault secret. Local providers (`ollama`, most LM Studio setups) need no key. A keyed connection with a locked vault surfaces "unlock the vault to use this connection". |
| Transport | JSON + **SSE** for streaming, matching the rest of `/api/v1`. |
| Go deps | **Target zero.** All four providers are `net/http` + `encoding/json`; SSE-response parsing is hand-rolled (the pattern already exists in `internal/sse` consumers). |
| Conversation history | Playground conversations are **ephemeral** in A0. Persisted history → A3. |
| Tool / function calling | **Deferred to A3.** A0–A2 are text-in / text-out (+ structured output via response parsing). |

No open questions block A0.

---

## 3. Scope

### 3.1 In scope (A0–A2)

- Connection CRUD + "test" (calls model-list) + live model listing with a
  short client-side cache.
- Raw chat (playground): pick connection + model, multi-turn, streamed.
- Task registry: browse built-in tasks, add/edit/reset custom tasks.
- Task run: `system = render(task.template, context)`, `messages = history +
  user input`, streamed; output rendered per `task.outputShape`.
- `AiPanel` + `useLlm(taskId)` — the drop-in consumer API.
- First consumers: **Prompt Library "Improve"** (A1), **Runbooks Assistant**
  (A2).

### 3.2 Out of scope

- Model fine-tuning / training, model download management (that is the
  provider's job — Ollama's own `pull`).
- Embeddings / vector store / RAG indexing — added only if a concrete module
  needs it (A3+).
- Agentic tool-use loops — A3.
- Billing/quota aggregation — A0 shows per-response token usage, nothing more.

---

## 4. Data model (`src/core/llm/**` — framework-free)

```ts
export type ProviderKind = 'ollama' | 'openai-compatible' | 'anthropic' | 'gemini'

export interface LlmConnection {
  id: string
  name: string
  provider: ProviderKind
  baseUrl: string           // '' → provider default (api.openai.com, localhost:11434, …)
  authSecretId?: string     // Vault secret id; omitted for keyless local providers
  defaultModel?: string
  createdAt: number
}

export type TaskOutputShape = 'text' | 'diff' | 'json'

export interface LlmTask {
  id: string                // 'prompt.improve', 'command.explain', …
  title: string
  description?: string
  builtin: boolean          // true = shipped in Go; a custom row of same id overrides it
  systemTemplate: string    // mustache-ish; {{context.*}} + {{input}}
  inputLabel?: string       // UI hint for the free-text field
  outputShape: TaskOutputShape
  suggestedModel?: string   // hint only
  temperature?: number
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface ChatRequest {
  connectionId: string
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}

export interface TokenUsage { promptTokens: number; completionTokens: number }
```

`{{context.*}}` is resolved by the **caller-supplied context object**. Example —
Prompt Library passes `{ selectionText, promptName, targetModel }`; the
`prompt.improve` template reads `{{context.selectionText}}`.

Built-in seed tasks (A1):

| id | shape | grounding context | purpose |
|----|-------|-------------------|---------|
| `prompt.improve` | `diff` | `{ text, promptName }` | rewrite a prompt/message for clarity + specificity, return the improved text |
| `prompt.draft` | `text` | `{ goal, style }` | draft a new prompt from a one-line goal |
| `command.explain` | `text` | `{ command, shell }` | explain what a shell/SSH command does, flag risks |
| `runbook.gen-step` | `json` | `{ intent, executor, priorSteps }` | produce a `{ name, script }` step from an intent |
| `runbook.fix-step` | `diff` | `{ script, error }` | given a failed step + its stderr, propose a fix |

---

## 5. Storage — `llm.db` (new pure-Go SQLite file)

Sibling of `history.db` / `orchestrator.db`, resolved the same way
(`--llm-db` flag, `"" = OS config dir`, `"off" = module disabled`).

```sql
CREATE TABLE llm_connection (
  id          TEXT PRIMARY KEY,
  conn_json   TEXT NOT NULL,     -- LlmConnection blob (no secret material)
  created_at  INTEGER NOT NULL
);
CREATE TABLE llm_task (
  id          TEXT PRIMARY KEY,  -- same id as a built-in → override
  task_json   TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE llm_settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
```

Keys never touch `llm.db` — only `authSecretId`. The plaintext key is fetched
from the Vault at request time, server-side, and never returned to the client
(same rule as the Runbooks SSH/HTTP auth).

---

## 6. Backend architecture — `backend/internal/llm/`

### 6.1 Provider interface

```go
type Provider interface {
    // ListModels queries the endpoint for its available models.
    ListModels(ctx context.Context, conn Connection, key string) ([]Model, error)
    // Chat streams a completion. Deltas go to out; the final usage is returned.
    Chat(ctx context.Context, conn Connection, key string, req ChatRequest, out chan<- Delta) (Usage, error)
    Kind() ProviderKind
}

type Delta struct { Text string; Done bool }
```

- `ollamaProvider` — `GET {base}/api/tags` for models, `POST {base}/api/chat`
  with `"stream": true` (newline-delimited JSON).
- `openAICompatibleProvider` — `GET {base}/v1/models`, `POST {base}/v1/chat/completions`
  with `"stream": true` (SSE `data:` lines, `[DONE]` sentinel). Covers OpenAI
  and every clone.
- A2: `anthropicProvider` (`/v1/messages`, `anthropic-version` header, SSE
  events), `geminiProvider` (`:streamGenerateContent`, key as query param —
  handled server-side so it never lands in a client URL).

`For(kind ProviderKind) Provider` — the dispatch, mirrors `executor.For`.

### 6.2 Task engine — `internal/llm/tasks`

- `Builtins() []Task` — the Go-defined set, compiled in.
- `Store.Resolve(id)` → custom row if present, else built-in, else `ErrNoTask`.
- `Render(task, context map[string]any) (systemPrompt string, err error)` —
  the `{{context.*}}` / `{{input}}` substitution. Reuses the runbook
  `{{VAR}}` regex family (candidate for a shared `core/templating/` extraction
  — see §10).
- `RunTask(ctx, taskID, connID, model, context, input, history, out)` —
  render → assemble messages → `Provider.Chat` → stream. For
  `outputShape: "json"` the engine also attempts a fenced-JSON extract and
  emits a final `parsed` event.

### 6.3 Endpoints (`/api/v1/llm/…`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/llm/connections` | list |
| POST / PUT | `/llm/connections[/{id}]` | upsert |
| DELETE | `/llm/connections/{id}` | remove |
| POST | `/llm/connections/{id}/test` | resolve key, call `ListModels`, report ok/err |
| GET | `/llm/connections/{id}/models` | live model list (cached ~60 s) |
| GET | `/llm/chat/stream` | raw chat SSE (`connId`, `model`, `messages` url-encoded) |
| GET | `/llm/tasks` | built-ins ∪ custom (with an `overridden` flag) |
| POST / PUT | `/llm/tasks[/{id}]` | upsert a custom task |
| DELETE | `/llm/tasks/{id}` | drop a custom task (reverts to built-in if one exists) |
| GET | `/llm/tasks/{id}/run/stream` | run a task SSE (`connId`, `model`, `context` json, `input`, `history` json) |
| GET | `/capabilities` | gains `"llm": { available }` + `llmProviders` |

Wired into `server.Options` as `LLM *llm.Store` + `LLMEngine *llm.Engine`;
`main.go` opens `llm.db` and constructs them when not `--llm-db off`. Nil →
every `/llm/*` endpoint 503s and the module shows the connect state.

### 6.4 Go dependencies

**None.** Each provider is stdlib HTTP + JSON. Streaming responses are parsed
with a small `bufio.Scanner` loop per wire format. If this proves painful for
Anthropic/Gemini in A2, any added dep goes through the CLAUDE.md library
license gate first.

### 6.5 Why no SDK / framework (decided 2026-08-31)

**No agent framework** (CrewAI, LangGraph, LangChain, Google ADK, AutoGen).
They are Python; the backend is one Go binary shipped as a Tauri sidecar
(CLAUDE.md). Adopting one means a second runtime in the bundle or a rewrite —
rejected. They also solve multi-agent orchestration, which is not what A0–A2
needs (call an endpoint, stream tokens, swap providers, inject a templated
system prompt).

**No provider SDKs** (`openai-go`, `anthropic-sdk-go`, `google/generative-ai-go`).
Four providers = four SDKs, each with its own transitive deps, release cadence,
and opinions about the HTTP client / streaming / auth — you adapt between four
SDK shapes instead of four wire formats. The wire formats (OpenAI
chat-completions, Anthropic messages, Ollama, Gemini generateContent) are
stable, documented, and ~80 lines each to implement. The `openai-compatible`
adapter alone reaches OpenAI, LM Studio, vLLM, LocalAI, OpenRouter, Groq,
Together, DeepSeek, Mistral — one adapter, most of the market, because they
all copy OpenAI's shape. `langchaingo` exists but lags its Python parent and
is thinly maintained — not something to build on.

**No Vercel `ai` SDK** on the frontend. Its `useChat`/`useCompletion` hooks
assume the LLM call happens in a JS/Node route handler and speak its own
data-stream protocol. Our call is in Go over plain SSE; adapting to Vercel's
format is more glue than the ~150-line Zustand `llmStore` already is.

**Frontend chat state** = Zustand (`llmStore`) + the existing `openStream` SSE
client + shadcn components. History persistence (A3) = SQLite rows in `llm.db`,
same JSON-blob pattern as everywhere else.

**Where an SDK could earn its place (A3+):** a real tool-calling agent loop
(model → tool → result → model, iterated). That loop is ~50 lines hand-rolled
or `anthropic-sdk-go`'s tool-runner — still Go, still no Python. Revisit only
when a module actually needs agentic behaviour.

**Maintenance verdict:** hand-rolled is the *lower*-maintenance choice given
the Go + Tauri-sidecar constraints — no dependency treadmill, one runtime,
`openai-compatible` covers most providers for free, and the wire formats
change slowly and additively.

---

## 7. Frontend — the T7 "Console Workspace" archetype (reused)

`src/adapters/ui/ai/` — single-tool shell module (`moduleTaxonomy.ts` id `ai`,
`hideToolPane`, `moduleRailRoute`), route `/tools/ai`. Own top nav:

- **Playground** — connection + model picker, message list, streamed replies,
  per-reply token usage. Ephemeral (A0).
- **Connections** — CRUD list; the editor picks provider kind, base URL, a
  Vault `SecretPicker` for the key (hidden for `ollama`), and a default model
  (populated from a live `test`).
- **Tasks** — built-in tasks (read-only, with "Customise" → clone into an
  editable copy) and custom tasks (full edit + "Reset to built-in"). A tiny
  run panel to try a task with hand-typed context.

Bottom status strip: backend state · N connections · vault state (keyed
connections need it).

### 7.1 The consumer API — `adapters/ui/ai/`

```tsx
// hook — the only thing a module imports
const { run, running, cancel } = useLlm('prompt.improve')
run({ context: { text: selection, promptName }, input: 'make it more specific' })
// → streams; resolves with { text, usage, parsed? }

// component — drop-in panel (one-shot or chat)
<AiPanel
  taskId="prompt.improve"
  context={{ text: selection, promptName }}
  mode="oneshot"                 // 'oneshot' | 'chat'
  onAccept={(text) => replaceSelection(text)}   // for outputShape 'diff'/'text'
/>
```

`AiPanel` owns: the connection/model picker (remembers last choice per task in
`localStorage`), the streaming view, and — for `diff` output — a word-level
diff of `context.text` → result with Accept / Reject (reuses the Prompt
Library's `diffWordsWithSpace` view).

### 7.2 How a module adds AI (the recipe)

1. **Grounding**: add a built-in `Task` to `internal/llm/tasks/builtins.go`
   (id `mymodule.dothing`, a system template, output shape). One function, no
   other backend change.
2. **UI**: render `<AiPanel taskId="mymodule.dothing" context={…} mode=… />`
   where the feature lives — a header button that opens it, a side panel, a
   toolbar. The only module-specific decision.
3. Nothing in `App`, `routes.tsx`, or the AI module changes.

---

## 8. Security model

- API keys live only in the Vault; the backend resolves them per-request and
  never returns them. Client never sees a key or a keyed URL (Gemini's
  query-param key is assembled server-side).
- The playground and task runs are **not** history-tracked by default (prompts
  can carry sensitive context). An opt-in "save this conversation" → A3.
- Task templates are treated as trusted config (the user wrote them). Context
  values are **data** — they are substituted, never interpreted as template
  syntax.
- A custom task cannot escalate: it only changes the system prompt for its own
  id. It cannot redirect to another connection or exfiltrate — the connection
  + model are always chosen by the caller / user, not the task.
- Backend still enforces the per-launch bearer token and loopback-only CORS.

---

## 9. Phasing

### A0 — Foundations — **DONE 2026-08-31**
- `internal/llm/`: `Provider` iface + `For`/`Providers`, `ollama` +
  `openai-compatible` adapters (stdlib HTTP+JSON, streamed), `Connection` store
  in `llm.db`, `Engine` (key resolution via the Vault, 60 s model cache,
  `Chat` fan-out to `sse.Message`).
- Endpoints: `/llm/connections` CRUD + `/{id}/{test,models}` +
  `/llm/chat/stream`. `capabilities` gains `"llm"` + `llmProviders`.
- `server.Options.{LLM,LLMEngine}` + `main.go` `--llm-db` + `openLLM()`
  (`"" = OS config dir`, `"off" = disabled`), 503 when absent.
- Frontend: `core/llm/llmModel.ts`, `adapters/backend/llmClient.ts`,
  `stores/llmStore.ts`, T7 `AiConsoleScaffold` (Playground + Connections,
  Vault button, backend gate), rail module `ai` ("AI Hub", `Sparkles`,
  `hideToolPane`), route `/tools/ai`.
- 5 new backend tests (store CRUD, both provider adapters over httptest,
  engine→SSE). No new Go deps.
- **Verified in-browser** against a live local Ollama: created a connection,
  Test pulled 5 models, playground streamed a completion ("pong", token usage
  shown) end-to-end through the Go backend; fresh-tab load has zero console
  errors.

### A1 — Grounding + first consumer — **DONE 2026-08-31**
- `internal/templating/` — extracted shared `{{TOKEN}}` engine (`Re`,
  `ExtractVars`, `Substitute`); `orchestrator/render.go` now delegates to it.
- `internal/llm/task.go` — `Task` + `TaskOutputShape` + `Builtins()` (the 5
  §4 seed tasks) + `RenderTask` (`{{context.*}}` always resolves — missing key
  → blank, not a leaked token). `store.go` — `ListTasks` (builtins ∪ custom,
  same-id custom overrides + `Overridden` flag) / `GetTask` / `PutTask` /
  `DeleteTask` (revert-to-builtin). `engine.go` — `RunTask` + a shared
  `stream()` (Chat and RunTask both use it); JSON-shape tasks emit a `parsed`
  event via `extractJSON` (fenced block or first balanced `{}`/`[]`).
- Endpoints `/llm/tasks` CRUD + `/{id}` + `/llm/tasks/{id}/run/stream`.
- Frontend: `core/llm` gains `LlmTask`/`taskContextKeys`; `llmClient` +
  `llmStore` task CRUD; **Tasks** nav section (`TasksView` — list, Customise a
  builtin → editable clone, Reset). `useLlm(taskId)` hook + `AiPanel`
  (connection/model picker remembered per task, streamed run, word-diff +
  Accept/Reject for `diff` shape).
- **Prompt Library "Improve"** — a Sparkles button on `MessageCard` toggles an
  inline `<AiPanel taskId="prompt.improve" context={{ text, promptName }}
  onAccept={…} />`; Accept replaces the message content (lands in the autosave
  draft). Delivers the deferred Prompt Library P5 improve feature.
- 3 new backend tests (templating, RenderTask/extractJSON, task CRUD+override).
  No new deps.
- **Verified in-browser** vs live Ollama: Tasks list shows all 5 builtins;
  `prompt.improve` run from a Prompt Library message streamed a rewrite, the
  word-diff rendered, Accept replaced the content; fresh-tab load zero console
  errors.

### A2 — Native providers + chat mode + Runbooks Assistant
- `anthropic` + `gemini` adapters.
- `AiPanel` `mode="chat"` (multi-turn with persistent grounding).
- Wire the **Runbooks Assistant** section (was R4 placeholder):
  `runbook.gen-step` (intent → step, inserts into the editor),
  `runbook.fix-step` (failed step + stderr → proposed fix),
  `command.explain` (on any shell/SSH step). Uses the run engine's redaction
  so secrets in context are masked before they reach a provider.
- **DoD**: connect Anthropic, generate a runbook step from an intent and insert
  it; on a failed run, "Explain / Fix" a step.

### A3 — Deferred
Tool/function-calling passthrough · conversation history persistence (opt-in) ·
token/cost aggregation view · embeddings endpoint (if a module needs RAG) ·
Anthropic prompt-caching hints · per-connection rate limiting · streaming
cancel polish.

---

## 10. Reused from existing code

| Need | Reuse |
|------|-------|
| Streaming | `internal/sse` + the frontend SSE client + `openStream` |
| Secret storage | the Runbooks **Vault** (`authSecretId` → `Resolve`), `SecretPicker` |
| Backend wiring | `server.Options` pattern, per-launch token, loopback CORS, `--*-db` flag + `appDataDir()` |
| SQLite | `modernc.org/sqlite`, the `Open(dsn)` + JSON-blob-row pattern from `orchestrator.Store` |
| `{{…}}` templating | the runbook `varRe` family — **extract `core/templating/` shared by runbook + llm** (candidate refactor, do it here) |
| Module shell | T7 "Console Workspace" (`RunbookConsoleScaffold` structure), `hideToolPane` + `moduleRailRoute` |
| Diff view | Prompt Library `diffWordsWithSpace` renderer |
| Optional-backend gating | `adapters/backend/useOptionalBackend.ts` / capability map — but this module is backend-**mandatory**, so the Runbooks `BackendUnavailable` gate is the closer fit |

---

## 11. Answering the framing questions directly

- **"one central llm logic … usable in other systems"** → `internal/llm/` +
  `core/llm/**` + `useLlm`/`AiPanel`. Modules never call a provider.
- **"connector for grounding based on selected view"** → the **Task**: an id +
  a system template with `{{context.*}}` slots. The view passes its current
  selection as `context`; the task decides what to do with it.
- **"add new submodule without rewriting the main app"** → §7.2: one built-in
  `Task` function + one `<AiPanel>` mount. No `App` / router / AI-module edit.
- **"Improve button vs chat box"** → both are `AiPanel` with `mode`. Ship
  one-shot Improve first (A1), flip on chat mode later (A2). Same code.
- **"now or later?"** → **now**, scoped to A0 + A1. It unblocks Prompt Library
  P5, Runbooks R4 Assistant, and the next module in one stroke, and it touches
  zero existing module code.
