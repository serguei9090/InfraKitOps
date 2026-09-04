# Porting or reusing this codebase

Two different things people mean by "port this":

1. **Fork it and rebrand/extend it** — keep the architecture, change the
   product. Most of this doc is for you.
2. **Reuse the architecture pattern in a different project** — take the
   hexagonal split and the "44 tools built the same way" recipe without
   the InfraKit-specific tools themselves.

## What's actually reusable, independent of the product

- **The hexagonal split** (`core/` framework-free, `adapters/` implements
  the ports) — see [Architecture overview](../architecture/overview.md).
  This is the part worth taking even if nothing else applies: it's why the
  frontend runs unmodified as a static site and inside a Tauri webview, and
  it's what let this project add ~15 backend-mandatory modules without ever
  touching the 44+ client-only tools.
- **The mode-aware repository pattern** — one repository interface
  (`ISchemaRepository`, prompt repository), two implementations (local
  `IStoragePort`, backend HTTP client), switched by `useAuthStore().mode`.
  Reusable any time a feature needs to work identically solo (no account)
  and multi-tenant (with one).
- **The `Task` grounding pattern** for AI — a central LLM layer + a
  `{{context.*}}`-templated task id + one drop-in `<AiPanel>` component,
  instead of every feature wiring its own model call. See
  [AI Hub](../modules/ai-hub.md#grounding-via-task).
- **The coded-error envelope** (`internal/apierr` + `core/errors/appError.ts`)
  — a closed set of error codes instead of ad hoc strings, classified once
  on the frontend into consistent toast/inline UI. See
  [Error handling](../modules/error-handling.md).
- **The `Runner`/executor abstraction** (Ansible's five runtimes, Runbooks'
  six executors) — one interface, multiple backends chosen at runtime,
  callers stay agnostic. Reusable any time "the same operation, several
  possible execution environments" comes up.

## Forking this specific project

1. Read [Getting started](getting-started.md), get both builds running.
2. Search-and-replace the product identity: `com.infrakit.studio` (Tauri
   identifier in `app/src-tauri/tauri.conf.json`), the package name in
   `app/package.json` and `backend/go.mod`, brand strings in `README.md`
   and the shell UI.
3. Decide what to keep from `moduleTaxonomy.ts` — every tool/module is
   independently registered (see [Adding a tool](adding-a-tool.md)), so
   deleting one is: remove its taxonomy entry, its route, and its
   `core`/`adapters` files. Nothing else references it directly.
4. If you don't need the backend at all, delete `backend/` and everything
   under `app/src/adapters/backend/` + the backend-mandatory modules
   (Network, Runbooks, AI Hub, Ansible) — the remaining 44+ client-only
   tools work unmodified as a pure static site.
5. Keep the license/attribution rules in `CLAUDE.md`'s
   [bundled-binary license rule](../../CLAUDE.md#bundled-binary-license-rule)
   in mind if you bundle any third-party binary of your own — MIT/BSD/ISC/
   Apache-2.0/MPL-2.0 only for anything shipped in an installer.
6. See [Deployment](../deployment/README.md) for how to ship your fork —
   desktop installer, Docker container, or a static host, same three
   options this project uses.

## Reusing just the pattern elsewhere

Start from [Architecture overview](../architecture/overview.md) and
[Adding a tool](adding-a-tool.md) — those two describe the mechanical
recipe (a `core/` use-case + a scaffolded screen + two registration lines)
independent of what any specific tool does. The scaffold components
(`ToolDetailScaffold`, `GeneratorScaffold`, etc. — see
[Frontend architecture](../architecture/frontend.md#scaffold-archetypes))
are InfraKit-specific UI, but the *shape* — a small fixed set of layout
archetypes every screen picks from, rather than a bespoke layout per screen
— is the transferable idea.

## What you should NOT assume carries over

- The Go backend's specific modules (ansible execution, LLM provider
  adapters, network tooling) are domain-specific to this product, not a
  generic framework.
- The Vault (`internal/vault`) is a real secrets store with real security
  properties (Argon2id, AES-256-GCM, per-user isolation under multi-user
  mode) — treat forking it as adopting that responsibility, not just
  copying code. Review [User management](../modules/user-management.md)
  and [Deployment → The vault](../deployment/DEPLOY.md#the-vault) before
  exposing it to real users' secrets.
