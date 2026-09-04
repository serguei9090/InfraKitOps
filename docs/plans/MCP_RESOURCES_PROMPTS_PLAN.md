# MCP — resources & prompts (A4f)

Status: **RP1–RP4 DONE + live-verified 2026-09-01.** Follow-up to
[`AI_MCP_PLAN.md`](AI_MCP_PLAN.md) (A4a–A4e, tools-only). Adds the other two
MCP primitives a server can expose so the user can pull server-curated
**context** and server-authored **prompt templates** into a chat.

Commits: `a7a1cf5` (RP1 backend) · `1543929` (RP2 resources in Playground) ·
`34557de` (RP3 prompts in Playground) · `79e050a` (RP4 `<AiPanel>`).
Verified end-to-end against `@modelcontextprotocol/server-everything`:
attach `architecture.md` → Gemini answers from its content (404 prompt
tokens); `args-prompt(city=Berlin)` → `"What's weather in Berlin?"` into the
composer; McpView shows `14 tools · 7 resources · 4 prompts`.

> Same naming caveat as A4: Knowledge Hub's `McpServersScreen` is a link
> list. This is the client. The AI Hub tab is "MCP".

---

## 1. Why

A4 wired **tools** — the model calls a function mid-answer. MCP servers also
expose:

- **Resources** — readable content addressed by URI: a file, a doc page, a DB
  schema, live data. The *host* (us) surfaces them; the user picks what to
  attach as context. Not model-invoked in v1.
- **Prompts** — named, argument-templated prompt snippets the server ships
  (e.g. Context7's "resolve-library-id", a git server's "summarize-changes").
  The user picks one, fills args, and it seeds the composer.

Concrete wins: attach a Context7 doc page or a filesystem server's file to a
question without copy-paste; invoke a server's canned workflow prompt instead
of retyping it.

Out of scope for tools already covered by A4 — this does **not** let the model
autonomously read resources (that needs host-mediated resource exposure in the
sampling/roots direction, which A4 deliberately skipped). Resources here are
**user-driven attachments** only.

---

## 2. Decisions

| # | Decision |
|---|----------|
| Resource trigger | **User-driven only.** A "Context" picker in the composer lists resources across enabled servers; the model never auto-pulls one. Keeps the trust model identical to "user opts a task into tools". |
| Resource injection | Client-side. `resources/read` → text is prepended to the outgoing messages as one `user` context block (`> from <uri>\n\n<text>`), immediately before the user's message. **Backend chat path untouched** — same mechanism as the live chat history array in `llmStore.sendMessage`. |
| Blobs / images | v1 **text only.** A binary resource (`blob`, non-text mime) shows in the picker as disabled with "binary — not supported yet". Vision-model image attach is a later phase. |
| Size cap | Reuse `maxResultBytes` (32 KiB) per resource; **96 KiB** total across all attached resources per send (drop extras with a toast). |
| Resource templates | Listed (`resources/templates/list`) and shown, but v1 only supports **concrete** resources. A templated URI (`file:///{path}`) renders an inline "enter {path}" field → expands to a concrete `resources/read`. |
| Prompts | `prompts/get` returns `messages[]`. v1: if it's a single `user` message → drop into the draft textarea (editable before send). If multiple / non-user → load as pre-filled chat turns (Playground only). |
| Prompt args | Small generated form from `prompt.arguments` (name / description / required). All values are strings (per spec). |
| Caching | Per-server, 60 s, same as tools. `ResourceListChangedHandler` / `PromptListChangedHandler` zero the cache (mirrors A4e-1). |
| Allowlist | None for v1. Reads and prompt-fetches are side-effect-free; `ServerConfig.ToolAllow` stays tools-only. |
| Capabilities | No new `capabilities` flag — `mcp` already gates the tab. McpView shows per-server counts. |
| Task integration | Deferred to RP4/later — `Task.resources []string` (always-inject URIs). v1 is interactive (Playground + `<AiPanel>`) only. |

---

## 3. Backend — `internal/mcp/`

### 3.1 Manager (`manager.go`)

`conn` gains two caches next to `tools`:

```go
type conn struct {
    session   *sdk.ClientSession
    cancel    context.CancelFunc
    tools     []ToolSpec
    resources []ResourceSpec
    templates []ResourceTemplateSpec
    prompts   []PromptSpec
    at        time.Time // tools cache stamp (existing)
    rpAt      time.Time // resources+prompts cache stamp
}
```

New methods (all connect-if-needed + 60 s cache, same shape as `Tools`):

- `Resources(ctx, id) ([]ResourceSpec, []ResourceTemplateSpec, error)` —
  `session.ListResources` + `session.ListResourceTemplates` (tolerate a server
  that supports neither: an "method not found" error → empty, not a failure).
- `ReadResource(ctx, id, uri) (ResourceRead, error)` — `session.ReadResource`,
  flatten `Contents[]` to `[]ResourceContent{URI, MIMEType, Text}`, cap each at
  `maxResultBytes`, set `Truncated`.
- `Prompts(ctx, id) ([]PromptSpec, error)` — `session.ListPrompts`.
- `GetPrompt(ctx, id, name, args) (PromptResult, error)` —
  `session.GetPrompt`, flatten `Messages[]` to `[]PromptMessage{Role, Text}`
  (only `*sdk.TextContent`; an `EmbeddedResource` message → its
  `Resource.Text`, prefixed `> from <uri>`).
- `AggregateResources(ctx)` / `AggregatePrompts(ctx)` — across enabled
  servers, skip-on-fail, same as `AggregateTools`.

`Connect` registers the two extra handlers in `sdk.ClientOptions`:

```go
ResourceListChangedHandler: func(...) { /* zero cc.rpAt */ },
PromptListChangedHandler:   func(...) { /* zero cc.rpAt */ },
```

`ServerStatus` gains `ResourceCount int` / `PromptCount int` (updated in a new
`markRP(id, r, p int)` called after a successful `Resources`/`Prompts` list).

### 3.2 Types (`spec.go`)

```go
type ResourceSpec struct {
    Server, ServerName string
    URI, Name          string
    Title, Description  string `json:",omitempty"`
    MIMEType           string  `json:",omitempty"`
    Size              int64    `json:",omitempty"`
}
type ResourceTemplateSpec struct {
    Server, ServerName string
    URITemplate, Name  string
    Title, Description  string `json:",omitempty"`
    MIMEType           string  `json:",omitempty"`
}
type ResourceContent struct {
    URI, MIMEType, Text string
}
type ResourceRead struct {
    Contents  []ResourceContent
    Truncated bool
}
type PromptArgSpec struct {
    Name, Description string
    Required         bool
}
type PromptSpec struct {
    Server, ServerName string
    Name               string
    Title, Description  string `json:",omitempty"`
    Arguments          []PromptArgSpec `json:",omitempty"`
}
type PromptMessage struct {
    Role, Text string
}
type PromptResult struct {
    Description string `json:",omitempty"`
    Messages    []PromptMessage
}
```

### 3.3 API (`api/mcp.go`)

| Method | Route | Body → Result |
|--------|-------|---------------|
| GET  | `/mcp/resources` | → `{resources: []ResourceSpec, templates: []ResourceTemplateSpec}` |
| POST | `/mcp/resources/read` | `{server, uri}` → `{contents: []ResourceContent, truncated}` |
| GET  | `/mcp/prompts` | → `{prompts: []PromptSpec}` |
| POST | `/mcp/prompts/get` | `{server, name, args: map[string]string}` → `{description, messages: []PromptMessage}` |

All go through the existing `guard` (503 when Manager nil) + `mcpErr`
(`apierr` classified). 75 s timeout like `ListTools`. Registered in `server.go`
next to the other `/mcp/*` routes.

### 3.4 Tests (`internal/mcp/*_test.go`)

Extend the existing in-process test server (the SDK ships one) to register a
resource + a prompt; assert `Resources`/`ReadResource`/`Prompts`/`GetPrompt`
round-trip, the cap truncates, and a `list_changed` notification zeroes
`rpAt`. `go test ./...` green.

---

## 4. Frontend

### 4.1 Model — `core/mcp/mcpModel.ts`

Add `McpResource`, `McpResourceTemplate`, `McpResourceContent`, `McpPrompt`
(+ `McpPromptArg`), `McpPromptMessage` — 1:1 with the Go types above.
`McpServerStatus` gains `resourceCount?` / `promptCount?`.

### 4.2 Client — `adapters/backend/mcpClient.ts`

`listResources()`, `readResource(server, uri)`, `listPrompts()`,
`getPrompt(server, name, args)` — same `backendGet`/`backendRequest` + `arr()`
null-guard pattern as the existing calls.

### 4.3 Store — `stores/mcpStore.ts`

Add `resources: McpResource[]`, `resourceTemplates`, `prompts: McpPrompt[]`,
and `loadResources()` / `loadPrompts()` (lazy, like the servers list).
`readResource` / `getPrompt` are pass-throughs that `reportError` on failure.

### 4.4 Playground composer — `adapters/ui/ai/PlaygroundView.tsx`

- Two header buttons next to "Tools": **Context** (`Paperclip`) and
  **Prompts** (`MessageSquareText`), both disabled when no enabled servers.
- **Context** opens a popover: resources + templates grouped by server, search
  box, binary rows disabled. Pick → `readResource` → push
  `{uri, name, text, truncated}` onto a local `attached` array.
- Attached resources render as removable chips in a row above the `Textarea`.
- `send()` prepends, for each chip:
  `{ role: 'user', content: `> context from ${uri}\n\n${text}` }` to the
  `outgoing` array (do it in `sendMessage` via a new
  `setChatContext(blocks)` on the store, mirroring `setChatTools`), then
  clears `attached`.
- **Prompts** opens a popover of `McpPrompt`s; pick → if it has required args,
  a small inline form; submit → `getPrompt` → single user message goes to
  `setDraft`, otherwise `startChat` + load messages as turns.

### 4.5 `<AiPanel>` — `adapters/ui/ai/AiPanel.tsx`

Chat mode (`mode="chat"`) gets the same **Context** button + chips (RP4).
Oneshot mode unchanged. Prompts stay Playground-only (a grounded task already
*is* a prompt).

### 4.6 McpView

Status line: `connected · 4 tools · 3 resources · 1 prompt · 2m ago`. Empty
counts omitted.

---

## 5. Phases

| Phase | Scope | Status |
|-------|-------|--------|
| **RP1** | Backend: manager methods + types + 4 endpoints + `rpAt` cache + 2 list_changed handlers + `ServerStatus` counts + `resources_test.go` (in-memory SDK transport via a new `dial` seam) | ✅ `a7a1cf5` |
| **RP2** | Resources in Playground: model + client + `mcpStore` lazy cache + `ContextPickerDialog` (concrete + templated, binary disabled) + chips + `llmStore.setChatContext` injection + McpView counts | ✅ `1543929` |
| **RP3** | Prompts in Playground: `PromptPickerDialog` + arg form + messages flattened to text → dropped in the draft | ✅ `34557de` |
| **RP4** | `<AiPanel>` Paperclip + chips (both modes), injected via `run({history})` | ✅ `79e050a` |

`Task.resources []string` (always-inject URIs) was **not** built — deferred
(see §7); needs a backend `TaskRunStream` change + `TaskDialog` UI.

Each phase is independently shippable; commit per phase (RP2/RP3 may split if
large). Live-verify against the `Everything` test server
(`npx -y @modelcontextprotocol/server-everything` — it exposes sample
resources + prompts) and Context7.

---

## 6. Security

- Resource reads and prompt fetches are **GET-shaped** — no writes, no
  approval gate needed. The A4c write-tool confirm flow is untouched.
- The 32 KiB / 96 KiB caps stop a huge resource blowing the model context or
  the response.
- `{{secret:}}` env + Bearer auth already applied at the transport layer
  (A4a) — resources/prompts ride the same authenticated session.
- Attached resource text is shown to the user as chips they can inspect/remove
  before send — nothing is injected silently.

---

## 7. Deferred past A4f

- `Task.resources []string` — always-inject URIs per grounding task
  (`TaskRunStream` resolve + `TaskDialog` UI). Interactive attach covers the
  need for now.
- Model-invoked / auto-attached resources (needs a roots-style host API).
- Image/blob resources → vision models.
- `resources/subscribe` live updates (poll-free resource change stream).
- Prompt picker in `<AiPanel>` (Playground-only for now — a grounded task
  already *is* a prompt).
