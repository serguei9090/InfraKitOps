# Adding a client-only tool

This is deliberately mechanical — the same three steps whether it's tool #1
or #100, so unrelated tools can be built in parallel with near-zero file
conflicts. If a change to a "tool" doesn't fit this shape, it's probably not
actually a client-only tool (see [Adding a backend module](adding-a-backend-module.md)
instead).

## 1. Core logic

`app/src/core/<domain>/<tool>.ts`, implementing:

```ts
interface IToolUseCase<TIn, TOut> {
  execute(input: TIn): TOut  // or Promise<TOut> if it needs to await something
}
```

Zero React imports. Zero DOM APIs unless the tool's whole point is a browser
API (e.g. Web Crypto, `File`). Unit test it alongside
(`<tool>.test.ts`) — this is where almost all the test coverage for a tool
lives, and it runs with no DOM.

## 2. Screen

`app/src/adapters/ui/tools/<Tool>Screen.tsx`. Pick a layout archetype (see
[Frontend architecture](../architecture/frontend.md#scaffold-archetypes) for
the full table):

- **`ToolDetailScaffold` (T1)** — default. Input | live-output split.
- **`GeneratorScaffold` (T5)** — config builders: single-column form, output
  reached from the header (Validate/Download/Preview/Copy).
- **`BalancedFlowScaffold` (T2)** — calculators with genuine computed results.
- **`StepperWorkspaceScaffold` (T3)** — row-by-row workflows.

A **catalog-style config builder** (SSH, sysctl, Zabbix, RDP) renders its
directive list through `adapters/ui/config/DirectiveCatalogEditor` instead
of hand-rolling the list UI — map the tool's `Xxx[]` catalog to
`CatalogItem[]` and pass `groups`/`values`/`onChange`/`presets`.

## 3. Register

- One entry in `app/src/adapters/ui/shell/moduleTaxonomy.ts` (icon, name,
  description, route, which module group it belongs to).
- One route in `app/src/routes.tsx`, using the **lazy** form like every
  other tool route — not an eager `element:` import (this is what keeps the
  entry bundle small):

```ts
{ path: 'tools/my-tool', lazy: () => import('./adapters/ui/tools/MyToolScreen').then((m) => ({ Component: m.MyToolScreen })) }
```

## That's it

No wiring into a central registry beyond those two files, no shared state to
touch, no backend required. Run `bun run test` and `bun run build` — a green
build + passing tests means the tool is done.

## If the tool needs persistence

Code against `IStoragePort` (`app/src/core/ports/IStoragePort.ts`), not
`localStorage` directly — it's the port that has both a web adapter
(`localStorage`) and a desktop adapter (Tauri `fs`), so the tool works
identically in both builds.

## If the tool could optionally use a backend

See the [Network Toolkit](../modules/network.md) or
[`docs/plans/TOOL_STRATEGY_REVIEW.md`](../plans/TOOL_STRATEGY_REVIEW.md) for
the `useOptionalBackend.ts` pattern — the client path stays the default and
must keep working with no backend present; the backend only adds a "power
mode" on top.
