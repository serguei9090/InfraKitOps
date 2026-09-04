# Getting started

## Prerequisites

- [Bun](https://bun.sh) — the package manager for `app/` (not npm/yarn/pnpm)
- Go 1.25+ — for `backend/`
- Rust + the Tauri v2 prerequisites — only if you're building the desktop
  shell (`cargo check` in `app/src-tauri/` should report a clean environment;
  `tauri info` confirms WebView2/MSVC/toolchain on Windows)

## Clone and run the frontend

```bash
git clone https://github.com/serguei9090/InfraKitOps.git
cd InfraKitOps/app
bun install
bun run dev            # http://localhost:1420
```

This alone gives you all 44+ client-only tools — no backend needed. Network,
Runbooks, AI Hub, and Ansible will show a "backend unavailable" state until
you also run the backend (next section).

## Run the backend

```bash
cd backend
go run ./cmd/infrakit-backend
```

Prints `LISTENING <addr>` and a `TOKEN <hex>` on first run (single-user
mode, the default). The frontend dev server auto-detects a sidecar-shaped
backend on the usual port; for a non-default setup use
Settings → Backend → "Endpoint override" or set `VITE_BACKEND_URL`.

## Run the desktop shell

```bash
cd app
bun run tauri dev      # wraps the same Vite dev server, opens a native window
```

This is the one thing that needs a manual pass in an environment without a
display — opening a native window isn't something an automated agent can
observe, so if you're verifying a UI change, run this yourself once.

## Run the tests

```bash
cd app && bun run test      # Vitest — core logic + component tests
cd backend && go test ./... # Go unit tests
```

## Build

```bash
cd app
bun run build               # static web build -> app/dist/
bun run build:sidecar       # cross-compile the backend into src-tauri/binaries/
bun run tauri build         # desktop installer (needs build:sidecar first)
```

## The one architecture rule that must never break

```bash
grep -rl "from 'react" app/src/core   # must print nothing
```

`app/src/core/**` is pure TypeScript with zero React imports. If this grep
ever finds something, the hexagonal boundary has been violated — see
[Architecture overview](../architecture/overview.md).

## Where to go next

- [Adding a tool](adding-a-tool.md) — the mechanical 3-step recipe for the 44+ client-only tools
- [Adding a backend module](adding-a-backend-module.md) — when a feature genuinely needs a backend
- [Testing](testing.md)
- [Porting this architecture elsewhere](porting-guide.md)
- [Module docs](../modules/) — how each existing module is built
