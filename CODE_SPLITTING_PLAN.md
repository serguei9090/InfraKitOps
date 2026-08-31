# Code-splitting & bundle budget

Status: **CS0–CS4 done 2026-09-01** (CS2 mostly fell out of CS1 for free).
Only leftover: swap `jsrsasign` for `@noble/*` (CS2 note). Flagged repeatedly
since `MIGRATION_PLAN.md` Phase 3.

**Result (2026-09-01 `bun run build`):**
```
index-*.js         144 kB │ gzip:  47 kB   ← entry (was 989 kB gzip)
vendor-react-*.js  282 kB │ gzip:  90 kB   ← stable framework chunk
--> first-load ≈ 140 kB gzip  (target was ≤ 350)
```
Every `/tools/*` + `/settings*` screen is now its own chunk; Rolldown
auto-hoisted shared heavy libs into their own chunks too (`pdfInspector`
205 kB gzip, `X509InspectorScreen`/jsrsasign 83 kB, `QrReaderScreen` 52 kB,
`js-yaml`, `crypto-js`, `fxp`, `bcryptjs` — all lazy). `bun run test` (1307) +
`lint` green; browser-verified: cold deep-link to `/tools/x509-inspector`
renders, client nav Data-Converter→Runbooks works, zero console errors.

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

### CS0 — Vendor chunk — **DONE**
- `vite.config.ts` `build.rollupOptions.output.manualChunks` — **function
  form only** (rolldown-vite types `manualChunks` as `ManualChunksFunction`,
  the object form is a TS error): match `node_modules/(react|react-dom|
  react-router|react-router-dom|scheduler)/` → `vendor-react`.
- `chunkSizeWarningLimit: 600` (pdf-lib is a deliberate lazy chunk).
- Skipped the visualizer dep — the build's own size table was enough.

### CS1 — Route-level lazy — **DONE (the main win)**
- Every `/tools/*` + `/settings*` route in `routes.tsx` →
  `lazy: () => import('...').then((m) => ({ Component: m.XxxScreen }))`.
  Done with a one-off codemod (`scratchpad/split-routes.mjs`, not committed).
- Eager kept: `AppShellScaffold`, `HomeDashboardScreen`, `ModuleToolsScreen`.
- `adapters/ui/shell/RouteFallback.tsx` — `RouteFallback` (root
  `HydrateFallback`, cold deep-link skeleton) + `RoutePendingBar` (thin top
  bar via `useNavigation()`, mounted in `AppShellScaffold`'s `<main>`). RR
  holds the previous screen during a client nav, so no fallback flash there.
- Entry 989 → **47 kB gzip**; ~110 route chunks.

### CS2 — Heavy-lib isolation — **mostly automatic**
Rolldown already hoisted every shared heavy lib into its own chunk once the
routes were split (`pdfInspector`, `X509InspectorScreen`/jsrsasign,
`QrReaderScreen`, `ExifViewerScreen`, `js-yaml`, `crypto-js`, `fxp`/
fast-xml-parser, `bcryptjs`, `cheatsheetContent`). Remaining optional work:

| Lib | Only used by | Note |
|-----|-------------|------|
| `jsrsasign` | `X509InspectorScreen`, `JwtParserScreen` | 83 kB gzip — check whether `@noble/*` (already a dep) can replace it |
| `pdf-lib` | `PdfSplitMergeScreen`, `PdfInspectorScreen` | 205 kB gzip, unavoidable for pdf-lib; fine as a lazy chunk |
| `diff` | `TextDiffScreen`, prompt/runbook compare | small, low priority |

Original CS2 table (verify each lands in its screen's chunk, not the entry):

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

### CS3 — Prefetch polish — **DONE 2026-09-01** (commit `<cs3>`)
- `adapters/ui/shell/prefetchRoute.ts` — `prefetchRoute(pathname)`:
  `matchRoutes(router.routes, pathname)` → calls each matched route's `lazy()`
  so the chunk is warm in the module cache before the click. `warmed` Set
  dedups; `@/routes` imported dynamically to dodge the routes⇢shell⇢sidebar
  cycle; `/` and empty are skipped.
- Wired to `onMouseEnter` + `onFocus` on: rail module icons + Settings
  (`RailIcon` gained `onPrefetch?`), the tool-list-pane rows (`ToolListPane`),
  and the "All Tools" `ToolCard`s (`ModuleSectionView`).
- First-load 176 → 181 kB gz (Rolldown re-chunked `appError`/`errorStore`/
  `errorIcon` into their own <2 kB chunks at the new dynamic-import boundary —
  still well under budget).
**DoD**: hover a rail icon, then click — screen is already mounted, no
`RoutePendingBar`. Verified in-browser (nav + zero console errors).

### CS4 — CI budget guard — **DONE 2026-09-01** (commit `<cs4>`)
- `app/scripts/check-bundle-size.ts` (`bun run check:bundle`) — sums the
  gzip size of the entry `<script>` + every `<link rel="modulepreload">` in
  `dist/index.html` (the true first-paint set; route chunks excluded).
  `BUDGET_GZIP_KB = 260`; current first-load **176 kB gz** (~48 % headroom).
- New **`.github/workflows/frontend.yml`** — was missing entirely: runs
  `lint` + `test` + `build` + `check:bundle` + `set-version` (drift check) on
  every `app/**` change. First frontend CI in the repo.
**DoD**: a heavy import that leaks into the shell path pushes first-load over
260 kB → `check:bundle` exits 1 → CI red.

## 5. Risks

- ~~**Rolldown vs Rollup option names**~~ — resolved in CS0: `manualChunks`
  works but **function form only** (object form is a TS error under
  rolldown-vite).
- **`lazy:` + error boundaries** — a chunk that 404s (stale deploy) needs a
  retry/refresh boundary. Add one in CS1.
- **Shared `src/core` graph** — over-splitting core can create waterfalls.
  Keep core eager unless the treemap proves a lib is core-only + heavy.
- **Base UI `render`-prop components** — no `asChild`; lazy boundaries don't
  interact with that, but verify a lazy screen inside a `<Dialog>` (e.g.
  settings sections) still mounts.
