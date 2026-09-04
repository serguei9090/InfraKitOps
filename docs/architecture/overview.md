# Architecture overview

InfraKit Studio is one React codebase shipped two ways — a static web app and
a Tauri desktop app — talking to an optional Go backend that runs as either
a **Tauri sidecar** (desktop) or a **standalone HTTP service** (hosted web).
44+ tools work with **no backend at all**; a handful of modules (Network,
Runbooks, AI Hub, Ansible) are backend-mandatory.

```mermaid
flowchart TB
    subgraph Client["React app (app/) — one codebase, two builds"]
        UI["adapters/ui/**<br/>shell + per-tool screens"]
        Core["core/**<br/>framework-free domain logic"]
        Storage["adapters/storage/**<br/>localStorage (web) / Tauri fs (desktop)"]
        UI --> Core
        UI --> Storage
    end

    subgraph Desktop["Desktop build"]
        Tauri["Tauri v2 shell<br/>WebView2 / WebKitGTK"]
        Sidecar["infrakit-backend<br/>(spawned sidecar process)"]
        Tauri -->|spawns, reads LISTENING addr + token| Sidecar
    end

    subgraph Web["Hosted web build"]
        Container["One container<br/>serves /api/v1/* + built frontend"]
    end

    Client -->|runs inside| Tauri
    Client -->|runs inside, or as static files| Container

    Client <-->|"HTTP + SSE, bearer/session token"| Sidecar
    Client <-->|"HTTP + SSE, bearer/session token"| Container

    subgraph Backend["Go backend (backend/internal/**)"]
        Router["chi router /api/v1<br/>auth + accessGuard + cors middleware"]
        Modules["one package per module<br/>orchestrator, ansible, llm, mcp, ..."]
        Vault["vault.enc<br/>Argon2id + AES-256-GCM"]
        DBs[("per-module SQLite<br/>orchestrator.db, llm.db, ansible.db,<br/>auth.db, history.db")]
        Router --> Modules
        Modules --> Vault
        Modules --> DBs
    end

    Sidecar --- Backend
    Container --- Backend
```

## The two build targets

| | Desktop | Hosted web |
|---|---|---|
| Frontend | same `app/dist`, wrapped by Tauri's WebView | same `app/dist`, served as static files |
| Backend | `infrakit-backend` spawned as a **Tauri sidecar**, per-launch token, loopback only | `infrakit-backend` runs standalone in a container, `--auth on` for multi-user, TLS via a reverse proxy or `--tls auto` |
| Auth | single-user, no login screen (`--auth off` behavior) | opt-in multi-user sessions (`--auth on`) — off by default, byte-identical to desktop when off |
| Data | `%APPDATA%`/`~/.local/share` + SQLite files next to the binary | one `/data` volume holding every `*.db` + `vault.enc` |

See [Deployment](../deployment/DEPLOY.md) for the hosted path and
[Desktop packaging](../deployment/desktop-packaging.md) for the installer.

## Hexagonal architecture (ports & adapters)

The rule that makes the two-target split possible: **`core/**` never imports
a UI framework.** Enforced by a grep check before every commit:

```bash
grep -rl "from 'react" app/src/core   # must print nothing
```

```mermaid
flowchart LR
    subgraph Inbound
        Screen["Tool screen<br/>(React component)"]
    end
    subgraph Core["core/** — pure TypeScript"]
        Port["Port (interface)<br/>IToolUseCase&lt;TIn, TOut&gt;"]
        Logic["Domain logic<br/>(the actual algorithm)"]
        Port -.implements.-> Logic
    end
    subgraph Outbound
        StoragePort["IStoragePort"]
        WebAdapter["localStorage adapter"]
        TauriAdapter["Tauri fs adapter"]
    end
    Screen -->|calls| Port
    Logic -->|depends on interface, not impl| StoragePort
    StoragePort -.-> WebAdapter
    StoragePort -.-> TauriAdapter
```

The backend mirrors the same idea one level down: `backend/internal/<module>`
owns its store (SQLite) and business logic; `backend/internal/api/<module>.go`
is the thin HTTP adapter translating requests into store calls. A module's
core logic has no `net/http` import; only the `api` package does.

This is why:

- The frontend runs unmodified in a browser tab or a Tauri webview.
- The backend runs unmodified as a spawned sidecar or a standalone container.
- A tool's business logic is unit-testable with zero DOM/HTTP mocking.
- Unrelated tools/modules can be built in parallel with near-zero file
  conflicts (the original reason this pattern was chosen — see
  [`docs/plans/MIGRATION_PLAN.md`](../plans/MIGRATION_PLAN.md)).

## Where to go next

- [Frontend architecture](frontend.md) — `core/` vs `adapters/`, routing, state, scaffolds.
- [Backend architecture](backend.md) — package map, per-module databases, middleware chain.
- [Request & auth flow](request-flow.md) — sequence diagrams for a typical request and a streamed run.
- [Modules](../modules/) — one doc per feature module.
- [Getting started](../development/getting-started.md) — clone, install, run.
- [Porting / reusing this architecture](../development/porting-guide.md).
