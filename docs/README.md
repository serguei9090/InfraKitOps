# InfraKit Studio documentation

Start at the root [`README.md`](../README.md) for a one-page overview. This
folder is the deeper reference: how the system is built, how each module
works, how to deploy it, and how to extend or fork it.

## Architecture

| Doc | Covers |
|---|---|
| [Overview](architecture/overview.md) | The two build targets (desktop/web), hexagonal ports & adapters, system diagram |
| [Frontend](architecture/frontend.md) | `core/` vs `adapters/`, routing, state, the scaffold archetypes |
| [Backend](architecture/backend.md) | Package map, per-module SQLite databases, the middleware chain, coded errors |
| [Request & auth flow](architecture/request-flow.md) | Sequence diagrams: a plain request, and a streamed run |

## Modules

One doc per feature module — what it does, an architecture diagram, and a
link to its full design-history plan doc.

| Module | Backend? |
|---|:---:|
| [Client-only tools](modules/utility-tools.md) (Tuning, Utilities, Config Builders, Office & Media) | no |
| [FormFlow](modules/form-flow.md) | optional (sharing only) |
| [Network Toolkit](modules/network.md) | **required** |
| [Prompt Library](modules/prompt-library.md) | optional (multi-user + AI) |
| [Runbooks](modules/runbooks.md) | **required** |
| [Ansible Manager](modules/ansible.md) | **required** |
| [AI Hub](modules/ai-hub.md) | **required** |
| [Settings](modules/settings.md) | partial |
| [User management](modules/user-management.md) | **required** (opt-in) |
| [Sharing](modules/sharing.md) | **required** (opt-in) |
| [Error handling](modules/error-handling.md) | both sides |
| [Observability](modules/observability.md) | backend |

## Deployment

| Doc | Covers |
|---|---|
| [Deployment overview](deployment/README.md) | Which of the three paths to pick |
| [Docker Compose guide](deployment/DEPLOY.md) | The full hosted-web walkthrough: TLS, the vault, backups, observability, restore |
| [Desktop packaging](deployment/desktop-packaging.md) | Building the Tauri installer, the release CI, what's not done yet |
| [Kubernetes](deployment/kubernetes.md) | The sketch manifest |

## Development

| Doc | Covers |
|---|---|
| [Getting started](development/getting-started.md) | Clone, install, run dev, run tests, build |
| [Adding a client-only tool](development/adding-a-tool.md) | The 3-step recipe used by all 44+ existing tools |
| [Adding a backend-mandatory module](development/adding-a-backend-module.md) | When and how to add a fifth backend module |
| [Testing](development/testing.md) | Frontend/backend test setup, manual verification, load testing |
| [Porting or reusing this codebase](development/porting-guide.md) | Forking the product, or reusing just the architecture pattern |

## Design history (`plans/`)

Every feature module was built from a written plan; those plans are kept
as a historical record — most are marked "done" and describe *why* a
decision was made, which the module docs above deliberately don't repeat.
Read a module doc first; follow its "Design history" link only if you need
the reasoning, the phase-by-phase sequence, or a specific commit hash.

Also in `plans/`: [`InfraKit Studio Specification.md`](plans/InfraKit%20Studio%20Specification.md)
(the original product spec) and [`design.md`](plans/design.md) (UI/visual
design rationale, still the source of truth for design rules like "the
selected-state must come from one shared token, never a one-off color").

## Project-level references (repo root)

Kept at the repo root, not under `docs/`, because they're operational
rather than reference material:

- [`../README.md`](../README.md) — the one-page project overview
- [`../CLAUDE.md`](../CLAUDE.md) — conventions and stack decisions for
  anyone (human or AI agent) working in this codebase day to day
- [`../ROADMAP.md`](../ROADMAP.md) — what's left, parked, or killed, kept
  current as work lands
- [`../LICENSE`](../LICENSE) — MIT
