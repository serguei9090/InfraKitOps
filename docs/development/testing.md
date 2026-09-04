# Testing

## Frontend (`app/`)

```bash
bun run test           # Vitest — everything below
bun run lint
bun run build          # tsc -b && vite build — catches type errors Vitest doesn't
```

Two environments, chosen per file, not globally:

- **`core/**` and most `.test.ts` files** run on Vitest's default `node`
  environment — no DOM, fast, and the large majority of test coverage lives
  here because `core/` logic is framework-free by construction.
- **Component tests** (`.test.tsx`) opt into a DOM by adding a docblock at
  the top of the file:

  ```ts
  // @vitest-environment happy-dom
  ```

  This is deliberate — `vite.config.ts`'s `environmentMatchGlobs` option is
  deprecated in Vitest 3.2+ (it suggests `test.projects` instead), and the
  per-file docblock achieves the same opt-in without a config change or
  slowing down the (much larger) `core/` suite.

`bun run build`'s `tsc -b` step catches real bugs Vitest's runtime tests
don't — a test's own mock objects must satisfy the full TypeScript
interface they're standing in for (a mock `IStoragePort` missing one method
passes Vitest but fails the build). Both matter; don't treat a green
`bun run test` alone as proof a change is safe to ship.

## Backend (`backend/`)

```bash
go vet ./...
go test ./...
gofmt -l internal/ cmd/    # must print nothing
```

Store/engine tests use a real (temp-file or `:memory:`) SQLite database,
not a mock — the point is to exercise real SQL, including the constraints
that only show up against the actual schema (foreign keys, unique
constraints, the single-connection pool some stores use deliberately).

## Manual verification

Two things automated tests structurally cannot cover:

1. **`bun run tauri dev` opening a real native window** — a GUI process, not
   observable by an automated agent. Run it yourself once per change that
   touches the desktop shell.
2. **Actual UI behavior in a browser** — type-checking and unit tests verify
   *correctness*, not that a feature *works* end to end. Start the dev
   server and click through the golden path before calling a UI change
   done.

## Load testing

`loadtest/` has k6 scripts (`static.js`, `api-read.js`, `sse.js`,
`write-contention.js`) for finding real throughput/latency ceilings against
a `docker compose` target — see [`docs/plans/POLISH_PLAN.md`](../plans/POLISH_PLAN.md)
PL6 for how to run them and a worked example of what they found (a
session-auth write serializing every authenticated request, fixed with a
before/after measurement, not a guess).

## The commit gate

Every commit is expected to build and pass tests **on its own** — see the
[commit workflow](../../CLAUDE.md#commit-workflow) in `CLAUDE.md`. Never
commit red; half-done work stays in the working tree or a stash.
