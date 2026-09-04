# Adding a backend-mandatory module

Client-only tools ([Adding a tool](adding-a-tool.md)) cover the large
majority of features. A module needs a backend only when it genuinely
requires something a browser sandbox cannot do: raw sockets/ICMP, spawning
processes (ansible/ssh), holding a long-lived encrypted secret store, or
calling out to an LLM provider with a key that shouldn't live in the
browser. Network, Runbooks, AI Hub, and Ansible are the four examples so
far — see their docs in [Modules](../modules/) for the pattern each one
landed on.

## Backend side

1. **One package**, `backend/internal/<module>/` — its own store (usually
   its own SQLite database file), its own business logic. No `net/http`
   import here.
2. **One thin API adapter**, `backend/internal/api/<module>.go` —
   translates HTTP requests into store/engine calls, writes
   `internal/apierr` coded responses (never a bare `{error: string}`).
3. **Register routes** in `backend/internal/server/server.go`, inside the
   appropriate auth block (public / authenticated / admin-only).
4. **A capability flag**, if the frontend needs to know whether this
   module's backend is present — extend the capabilities map returned
   alongside `/health` or a dedicated status endpoint.
5. Unit tests alongside the store/engine — see [Testing](testing.md).

## Frontend side

1. `app/src/core/<module>/**` — framework-free domain types/logic (request/
   response shapes, any client-side validation), same hexagonal rule as
   everything else in `core/`.
2. `app/src/adapters/backend/<module>Client.ts` — the HTTP/SSE client. Let
   it throw `AppErr` on failure (see [Error handling](../modules/error-handling.md))
   rather than swallowing errors.
3. A Zustand store in `app/src/stores/` only if the module needs state that
   outlives a single screen (a live run's event log, a connection status).
4. A screen or console:
   - If it fits the existing rail + swap-pane shell alongside client-only
     tools, build it like any other tool screen.
   - If it's a full backend-mandatory module with its own navigation
     (Runbooks, Ansible, AI Hub all do this), use the **T7 console**
     pattern: its own top nav, not the shared swap pane, registered as a
     single-tool shell module (`ModuleDef.hideToolPane` +
     `moduleRailRoute()` so the rail opens it directly).
5. Register in `moduleTaxonomy.ts` + `routes.tsx`, same as a client-only
   tool.

## Streaming, if the module runs something long

Use Server-Sent Events (`internal/sse` on the backend, `sseClient.ts` on the
frontend) — see [Request & auth flow](../architecture/request-flow.md) for
the full sequence. Not WebSockets: SSE reverse-proxies more simply and the
browser's `EventSource` retries on its own.

## If it needs secrets

Resolve them server-side from the shared **Vault**
(`backend/internal/vault`) — never send a secret to the browser, and
redact any secret value from log lines / SSE events before they leave the
process. See [Runbooks](../modules/runbooks.md) for the `{{secret:NAME}}`
pattern.

## Grounding it with AI (optional)

Don't wire a module's own LLM call. Register a **Task** in
`internal/llm/task.go::Builtins()` and drop in `<AiPanel taskId context />`
from the frontend — see [AI Hub](../modules/ai-hub.md#grounding-via-task).
