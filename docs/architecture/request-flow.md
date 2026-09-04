# Request & auth flow

Two sequence diagrams that cover most of what happens on the wire: a plain
authenticated request, and a streamed run (runbook / Ansible / AI chat all
follow the same shape).

## A plain authenticated GET/PUT

```mermaid
sequenceDiagram
    participant UI as React screen
    participant Client as adapters/backend/&lt;module&gt;Client.ts
    participant MW as server middleware
    participant Auth as auth.LookupSession (auth.db)
    participant API as api/&lt;module&gt;.go
    participant Store as internal/&lt;module&gt;/store.go (SQLite)

    UI->>Client: call e.g. listRunbooks()
    Client->>MW: GET /api/v1/runbooks (Authorization: Bearer <token>)
    MW->>Auth: validate token
    Auth-->>Auth: SELECT session; if stale >5min, UPDATE slide expiry
    Auth-->>MW: *auth.User
    MW->>API: request + user on context
    API->>Store: ListRunbooks(viewer)
    Store-->>API: []*Runbook (batched queries, not N+1)
    API-->>Client: 200 JSON
    Client-->>UI: typed result
```

The 5-minute slide-throttle and the batched `ListRunbooks` query exist
because of a real incident found by load-testing — see
[`docs/plans/POLISH_PLAN.md`](../plans/POLISH_PLAN.md) PL6 for the before/after
numbers (p95 3.9s → 34ms). It's a useful example of the shape every
authenticated endpoint has: middleware auth check, thin API handler, a store
method that owns its own SQL.

## A streamed run (Runbooks / Ansible / AI chat)

```mermaid
sequenceDiagram
    participant UI as Console screen (T7 scaffold)
    participant SSE as sseClient.ts (EventSource)
    participant API as api/&lt;module&gt;.go
    participant Engine as Engine (orchestrator / ansible / llm)
    participant Exec as executor (shell/ssh/http/python)

    UI->>SSE: openStream(POST .../run/stream)
    SSE->>API: GET .../run/stream?token=...
    API->>Engine: Run(spec, args)
    Engine->>Exec: spawn step 1
    Exec-->>Engine: stdout/stderr chunks
    Engine-->>API: run-start, step events (SSE)
    API-->>SSE: text/event-stream
    SSE-->>UI: onEvent(parsed)
    loop each step
        Engine->>Exec: spawn next step
        Exec-->>Engine: output / exit code
        Engine-->>API: step event
        API-->>SSE: event
    end
    Engine-->>API: run-end (status)
    API-->>SSE: event
    SSE-->>UI: mark run finished
```

Secrets (`{{secret:NAME}}`) are resolved server-side from the Vault and
redacted from every event before it leaves the process — the browser never
sees a plaintext secret in the stream. Destructive-pattern scanning and
`RequiresApproval` gating (multi-user) both happen in the Engine, before the
first step ever spawns.

## Where to go next

- [Backend architecture](backend.md) — the middleware chain in more depth
- [Runbooks](../modules/runbooks.md), [Ansible](../modules/ansible.md), [AI Hub](../modules/ai-hub.md) — the three modules that use this streaming shape
