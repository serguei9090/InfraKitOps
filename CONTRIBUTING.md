# Contributing

Thanks for looking. This is a solo-maintained project; issues and PRs are
welcome, but please open an issue to discuss anything non-trivial before
writing a large change.

## License

By contributing you agree your work is licensed under the project's
[GNU AGPL-3.0-or-later](LICENSE). New modules and adapters are covered by the
same license — if you build one and want it upstream, that is the deal.

## Repo layout

| Path | What |
|---|---|
| `app/` | React 19 + Vite + TypeScript frontend, Tauri v2 desktop shell |
| `backend/` | Go 1.25 service (`chi`, `modernc.org/sqlite`, no cgo) |
| `docs/` | architecture, one doc per module, deployment, development guides |
| `deploy/` | container + compose + Caddy + observability overlay |
| `CLAUDE.md` | the long-form stack rationale and day-to-day conventions |

Architecture is strict hexagonal — `app/src/core/**` is pure TypeScript with
**zero React imports** (CI greps for it). Full picture:
[`docs/architecture/`](docs/architecture/overview.md).

## Build & run

Frontend (from `app/`):

```bash
bun install
bun run dev            # Vite dev server — http://localhost:1420
bun run tauri dev      # desktop dev (wraps the same Vite server)
```

Backend (from `backend/`):

```bash
go run ./cmd/infrakit-backend    # prints LISTENING <addr> + a bearer TOKEN
```

Point the frontend at it via `app/.env.local`
(`VITE_BACKEND_URL=http://127.0.0.1:8765`, `VITE_BACKEND_TOKEN=…`) or
Settings → Backend → Endpoint override.

## The green gate — run before every commit

Never commit red. Half-finished work stays in the working tree.

```bash
# frontend (from app/)
bun run build && bun run test && bun run lint
bun run check:bundle          # first-load gzip budget

# backend (from backend/, if you touched it)
go vet ./... && go test ./...
```

## Commits

- **One logical change per commit** — not one file, not one session. If the
  subject needs an "and", it is probably two commits.
- Each commit must build and pass tests **on its own**.
- Conventional-ish subject saying *what* changed; body for non-obvious
  decisions and test status.
- Straight to `main` for maintainers; PRs from a branch for everyone else.

## Adding a tool or a module

`docs/development/adding-a-tool.md` walks through the mechanical steps (core
file + screen + one taxonomy entry + one lazy route). A backend-driven module
is a bigger lift — see the existing `*_MODULE_PLAN.md` docs in `docs/plans/`
for the shape.

## Demo media

`tools/capture/` regenerates `docs/assets/demo.gif` / `demo.mp4` and the
screenshots. Re-run it when a UI change makes the media stale.

## Security

Do not open a public issue for an exploitable bug — see [`SECURITY.md`](SECURITY.md).
