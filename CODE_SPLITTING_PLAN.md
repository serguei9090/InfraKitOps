# Code-splitting & bundle budget

Status: **proposal, not started (2026-09-01).** Flagged repeatedly since
`MIGRATION_PLAN.md` Phase 3 ("route-based code-splitting via `React.lazy` is
worth doing before Phase 7 packaging"). Deferred long enough that the bundle
has grown.

## 1. Baseline (2026-09-01, `bun run build`)

```
dist/assets/index-*.js     3,128 kB  │ gzip: 989 kB   ← single eager chunk
dist/assets/GeoMap-*.js       58 kB  │ gzip:  21 kB   ← already lazy
dist/assets/index-*.css       97 kB  │ gzip:  16 kB
```

One monolithic JS chunk. Every tool screen + every heavy lib (`pdf-lib`,
`jsrsasign`, `exifr`, `qrcode`, `jsqr`, `js-yaml`, `fast-xml-parser`,
`bcryptjs`, `pako`, `diff`) loads on first paint even though a cold user hits
one route.

Target: **first-load JS ≤ ~350 kB gzip**; every `/tools/*` screen its own
chunk; heavy libs only in the chunk that uses them.

## 2. Why it is safe now

- `routes.tsx` is already a flat `createBrowserRouter` array — 90+ `element:`
  entries, each a single screen import. Mechanical to convert.
- Screens are self-contained (hex boundary — `src/core/**` is where shared
  logic lives, and that stays eager or splits with its consumer).
- The shell (`AppShellScaffold`, sidebar, stores) is the only guaranteed-eager
  surface.

## 3. Decisions

| # | Question | Default |
|---|----------|---------|
| A | `React.lazy` + `<Suspense>` per route vs router `lazy:` (data-router native) | **router `lazy:`** — `createBrowserRouter` supports `lazy: () => import(...)` per route, no `<Suspense>` boilerplate, integrates with the router's pending UI |
| B | Granularity — one chunk per screen vs one per module | **per screen** (Rollup will merge tiny siblings; per-screen keeps the mental model simple and matches the file layout) |
| C | Loading UI | a lightweight `<RouteFallback>` (skeleton of `ToolScaffoldHeader` + panel) — reuse the shell's existing skeleton tokens |
| D | Prefetch on rail hover | **CS3, optional** — `import()` the target route on `mouseenter` of a rail/tool link |
| E | CI budget guard | **yes, CS4** — fail the build if the entry chunk gzip exceeds a threshold |

## 4. Phases

### CS0 — Vendor / manualChunks split + measure
- `vite.config` `build.rollupOptions.output.manualChunks` (or Rolldown's
  `advancedChunks`) — pull `react`, `react-dom`, `react-router` into a stable
  `vendor-react` chunk; `@base-ui/react` + `lucide-react` into `vendor-ui`.
- Add `bun run build -- --report` note / `rollup-plugin-visualizer` (dev-only
  dep) to get a treemap; record the top 15 modules here.
**DoD**: no behaviour change; documented breakdown. One commit.

### CS1 — Route-level lazy (the main win)
- Convert every `/tools/*` and `/settings*` route in `routes.tsx` to
  `{ path, lazy: () => import('./adapters/ui/tools/XxxScreen').then(m => ({ Component: m.XxxScreen })) }`.
- Keep eager: `AppShellScaffold`, `HomeDashboardScreen`, `ModuleToolsScreen`
  (index + first-paint routes).
- Add `<RouteFallback>` via the router's `HydrateFallback` / a wrapper.
- Codemod: the import list + the element array are 1:1 — script it, don't
  hand-edit 90 lines.
**DoD**: build shows ~90 `tools/*` chunks; entry chunk drops below ~500 kB
gzip; click-through of 10 varied tools works with the fallback flashing only on
cold nav; fresh-tab zero console errors. One commit.

### CS2 — Heavy-lib isolation
Verify (via the CS0 treemap) each lands in its screen's chunk, not the entry:

| Lib | Only used by |
|-----|-------------|
| `pdf-lib` | `PdfSplitMergeScreen`, `PdfInspectorScreen` |
| `jsrsasign` | `X509InspectorScreen`, `JwtParserScreen` (biggest single lib — check if `@noble/*` already covers the need) |
| `exifr` | `ExifViewerScreen` |
| `qrcode` / `jsqr` | `QrCodeScreen` / `QrReaderScreen` |
| `js-yaml`, `fast-xml-parser`, `smol-toml` | `ConvertersScreen`, `FormattersScreen`, `StructuredTreeViewerScreen` |
| `bcryptjs` | `BcryptScreen`, `HtpasswdGeneratorScreen` |
| `pako` | `GzipConverterScreen`, `Base64FileScreen` |
| `diff` | `TextDiffScreen`, prompt/runbook version compare |

- Where a `src/core/**` module statically imports one of these and is itself
  imported by an eager path, add a dynamic `import()` at the core boundary or
  move the static import into the screen.
- `@fontsource-variable/geist` — confirm it stays as the separate `woff2`
  assets it already is (don't inline).
**DoD**: entry chunk ≤ ~350 kB gzip; each heavy lib appears in exactly one
lazy chunk. One commit.

### CS3 — Prefetch polish (optional)
- On `mouseenter` / `focus` of a rail icon or a tool card, fire the route's
  `import()` so the chunk is warm before the click.
- `<Link>`-level: a tiny `usePrefetchRoute(path)` hook keyed off the same
  `routes.tsx` map.
**DoD**: no measurable delay on rail navigation after a hover. One commit.

### CS4 — CI budget guard
- Post-build script: read `dist/assets/*.js` sizes, gzip the entry chunk,
  fail if > budget (start at the CS2 number + 15 % headroom).
- Wire into `frontend.yml` (or `backend.yml`'s sibling).
**DoD**: a deliberate fat import fails CI. One commit.

## 5. Risks

- **Rolldown vs Rollup option names** — the repo is on `vite v8` /
  Rolldown (`build.rolldownOptions`). `manualChunks` may be `advancedChunks`.
  Check the installed version's docs in CS0.
- **`lazy:` + error boundaries** — a chunk that 404s (stale deploy) needs a
  retry/refresh boundary. Add one in CS1.
- **Shared `src/core` graph** — over-splitting core can create waterfalls.
  Keep core eager unless the treemap proves a lib is core-only + heavy.
- **Base UI `render`-prop components** — no `asChild`; lazy boundaries don't
  interact with that, but verify a lazy screen inside a `<Dialog>` (e.g.
  settings sections) still mounts.
