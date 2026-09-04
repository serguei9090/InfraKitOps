# Migration Plan — Flutter → React + Tauri v2 (Go backend later)

Status: **Phase 0 through Phase 6 all done** (2026-08-25) — **full 44-tool parity
with the Flutter app reached**, plus persistent storage (web verified live,
desktop compiles clean but unverified — no way to open a native window here).
Phase 9 (retire Flutter) in progress now. Phases 7 (packaging) and 8 (Go backend)
deliberately deferred — no reason to package or start backend work before the
frontend port is fully settled, and the Flutter app never had backend features to
match anyway. Reference implementation: the current
Flutter app (`lib/**`, 44 tools across 6 modules, hexagonal architecture, client-only —
see `README.md` and `design.md`).

## Research notes (current as of 2026-08-25)

- **Tauri v2 is stable**: GA'd 2 October 2024, currently at v2.10.x. Plugin
  architecture (`fs`, `dialog`, `shell`, `updater`, etc.) is mature. —
  [Tauri 2.0 Stable Release](https://v2.tauri.app/blog/tauri-20/),
  [Tauri Core Releases](https://tauri.app/release/core/)
- **Sidecar** is the mechanism for the future Go backend: Tauri can bundle and manage
  the lifecycle of an external binary (any language, including Go) declared in
  `tauri.conf.json`'s `bundle.externalBin`, invoked via the shell plugin with
  `Command.sidecar(...)`, permission-gated by Tauri's capabilities system. This is the
  clean way to ship "desktop app + local Go service" as one installer without asking
  the user to run a separate process. — [Embedding External Binaries (Sidecar)](https://v2.tauri.app/develop/sidecar/)
- **Same webview runtime for both targets**: Tauri's webview (WebView2 on Windows,
  WebKitGTK on Linux) is a real browser engine, not a custom renderer — so the same
  React/Vite build that runs as a static webapp runs unmodified inside Tauri. This is
  what preserves the Flutter app's "one codebase, two targets" property.

## Guiding constraints (carried over from the current spec/design docs)

1. **Client-only until the Go phase is explicitly started.** The original spec's §5
   "client-first" constraint holds during the frontend migration. No premature backend
   coupling.
2. **Hexagonal boundary is non-negotiable.** `src/core/**` never imports UI or Tauri
   APIs. This is what made 44 tools portable/parallelizable once already — preserve it
   through the port, don't just aim for "looks the same."
3. **Old Flutter app is the source of truth until parity + verification.** Don't delete
   `lib/**` mid-migration. Port from it, diff behavior against it, retire it last.
4. **Keep the parallel-agent-friendly registration pattern.** Two-file, two-line tool
   registration (taxonomy entry + route) is why Phase 1/2 tools in the original build
   could be built by multiple background agents with zero conflicts. Replicate this
   exactly in the React structure — see `CLAUDE.md`'s "Adding a new tool" section.

## Phase 0 — Scaffold — **done 2026-08-25**

- [x] `npm create vite@latest app -- --template react-ts` — new working tree at
  `app/`, parallel to `lib/**`, not replacing it.
- [x] Tauri v2 shell in `app/src-tauri/` (`identifier: com.infrakit.studio`), minimal
  Rust, no business logic yet.
- [x] Installed: `react-router-dom`, `zustand`, `tailwindcss` v4 (+ `@tailwindcss/vite`),
  shadcn/ui, `lucide-react`, `react-hook-form`, `zod`, `@hookform/resolvers`,
  `@tauri-apps/api` + `@tauri-apps/cli`.
- [x] Ported `app_theme.dart`'s seed color (`#4F46E5` indigo →
  `oklch(0.457 0.24 277.023)` light / `oklch(0.673 0.182 276.935)` dark) into
  `app/src/index.css`'s `--primary`/`--ring`/`--sidebar-primary` tokens.
  **Not yet ported**: flat cards + hairline border + 16px radius, tightened type
  scale, monospace panel style, the selected-state color/radius convention — deferred
  to Phase 2 (shared UI primitives), since those are component-level, not
  theme-token-level.
- [x] Shell skeleton: `AppShell.tsx` (icon rail + swap pane, `design.md`'s "iteration
  3" layout), layout route in `routes.tsx`, empty `moduleTaxonomy.ts` (typed, no data
  yet — Phase 3 populates it).
- [x] `npm run build` (web) verified — compiles clean, confirmed rendering in-browser
  (title, shell layout, placeholder text all correct).
- [x] `cargo check` in `app/src-tauri/` verified — Rust side compiles clean. `tauri
  info` reports a fully green environment (WebView2 152.x, MSVC Build Tools, Rust
  1.92 toolchain).
- [ ] **Not verified**: `npm run tauri dev` actually opening a native window. Launching
  a GUI process isn't observable from this environment (no way to screenshot a native
  Win32 window) — run it yourself once to confirm the desktop shell opens before
  starting Phase 1.

Open questions from the original write-up, now resolved:
- **Repo layout**: new app lives in `app/` inside this same repo, side-by-side with
  `lib/**`, so both can be run and diffed during the port (as favored above).
- **Package manager**: npm — already on the dev machine, no reason to add pnpm/yarn.
- **Global Cmd/Ctrl+K search**: not built in Phase 0. Staying out of migration scope;
  revisit as a fast-follow after Phase 9, per the original spec's status (never built
  in the Flutter version either).

## Phase 1 — Core domain logic (no UI) — **done 2026-08-25**

Ported all of `lib/core/**` (except `office_media/` and `form_flow/`, which stay
Phase 4/5) to `app/src/core/**` — **41 files, 811 Vitest tests, 100% passing**. Done via
4 parallel background agents (tuning+config, crypto/security, data-formats,
network/parsing+cheatsheets), each independently reading its Dart source+test pairs and
writing colocated `*.ts`/`*.test.ts` files — no file overlap, no shared-state races
(each verified only its own files with scoped `vitest run`, none touched
`package.json` or ran `tsc -b`/full build).

- `utility/` (27 files) — hashing (`crypto-js`; SHA3-512 substituted for Dart's
  BLAKE2b-512, `crypto-js` has no BLAKE2b), bcrypt (`bcryptjs`, emits `$2b$` not
  Dart's `$2a$` but cross-verifies fine), UUID/ULID (`uuid`, `ulidx`), Ed25519 SSH
  keygen (`@noble/curves`), X.509 inspection (`jsrsasign`), data-format conversion
  (`smol-toml`, `fast-xml-parser`, `js-yaml`), gzip (`pako`), and ~15 dependency-free
  files (subnet/IP/MAC tools, regex tester, JWT parser, JSONPath, diff, formatters,
  text transforms) ported straight to browser builtins.
- `tuning/` (5 files) — Ceph PG calculator, DB memory sizer, Linux sysctl tuner, Zabbix
  sizer, sysctl config builder. No dependencies.
- `config/` (6 files) — crontab/chmod/firewall (rule+command)/docker-run/database config
  builders. No dependencies.
- `cheatsheets/` (1 file) — ~1470 lines of static reference data, machine-converted from
  the Dart source (a one-off script handling Dart's raw-vs-escaped string semantics) and
  verified against the ported structural-integrity tests.

**Post-port fixes** (done by the orchestrating session after the agents finished, not
part of any agent's own verification): `vite.config.ts` needed `mergeConfig` instead of
building straight off `vitest/config`'s `defineConfig` — the project's Vite/Rolldown
version and vitest's bundled-internal Vite version have incompatible plugin types
otherwise. Two dead unused functions removed (`triadToString` in `chmodCalculator.ts`,
`cidrBlocksEqual` in `ipRangeTool.ts`). `jsonpathEvaluator.ts`'s constructor
parameter-property shorthand (`constructor(private readonly x: string)`) isn't erasable
under this project's `erasableSyntaxOnly` tsconfig setting — rewritten as explicit field
+ constructor-body assignment. `x509Inspector.ts`'s SAN/CRL helper functions were typed
against an invented `Record<string, string>` shape instead of jsrsasign's actual
`GeneralName` discriminated union (which includes `undefined` as a member) — retyped to
match. Full `bun run test` (811/811) and `bun run build` (tsc -b + vite build) both
verified clean after these fixes, plus a repo-wide grep confirming zero React imports
under `src/core/**`.

## Phase 2 — Shared UI primitives + shell wiring — **done 2026-08-25**

- [x] `ToolDetailScaffold` (`app/src/adapters/ui/shell/ToolDetailScaffold.tsx`) —
  split-panel input/output layout, Wireframe 2, copy-to-clipboard button. Not yet
  consumed by any tool screen (Phase 3 does that) but built and ready.
- [x] `ModuleSectionView` / `ToolCard` (`ModuleSectionView.tsx`) — card grid, shared by
  `HomeDashboardScreen` (all modules) and `ModuleToolsScreen` (one module, `/modules/:id`)
  via the same `linkHeaderToModulePage` prop the Flutter version used, so the two pages
  can't drift apart.
- [x] `AppSidebar.tsx` (icon rail + swap pane) + `ModuleSettingsDialog.tsx` (reorder +
  hide), backed by `useModuleVisibilityStore` (Zustand, `app/src/stores/`) — mirrors
  `module_visibility_provider.dart`. **Reorder UI is up/down buttons, not drag-and-drop**
  — a deliberate scope trim (same end result, less complexity than wiring a DnD lib);
  revisit if it feels wrong in practice.
  Prefs are in-memory only (reset on reload), same unresolved limitation the Flutter
  version had — still deferred to Phase 6 storage work.
- [x] `AppShellScaffold.tsx` — top bar (brand mark, search input, theme toggle) +
  `AppSidebar` + routed content. Theme toggle (`useThemeStore`, defaults to dark, mirrors
  `theme_provider.dart`) works by flipping Tailwind's `.dark` class on `<html>`.
- [x] Full `moduleTaxonomy.ts` ported verbatim from `module_taxonomy.dart` — all 6
  modules, all 44 tool entries (name/description/icon/id), Material→Lucide icon mapping
  done per-entry. **Every entry's `route` is currently `undefined`** (shows "Coming soon"
  in the UI) — Phase 3 sets `route` as each tool's screen actually gets ported, exactly
  matching the nullable-route "not implemented yet" mechanic the Flutter version used
  early on.
- [x] Verified end-to-end in-browser (not just typecheck): navigation between "All
  Tools" and per-module pages, rail module switching, settings dialog reorder + hide
  (live-reflected on the rail), theme toggle both directions, swap-pane search filter.
- **Not done / deferred**: the Flutter version's `<720px` compact mode (inline search →
  modal, inline tool-list pane → bottom sheet). This port is desktop-first; compact mode
  is a fast-follow, not a Phase 2 blocker.
- Global search (Cmd/Ctrl+K fuzzy search) — still not built, per the Phase-0 decision to
  keep it out of migration scope (the Flutter version never built it either).
- Note: the shadcn/ui install in this project resolved to **Base UI primitives**
  (`@base-ui/react`, the "base-nova" style), not Radix — no `asChild` prop; composition
  uses a `render` prop instead (`<DialogTrigger render={<Button/>} />`), and
  `TooltipProvider` takes `delay` not `delayDuration`. Keep this in mind before copying
  Radix-based shadcn examples from memory/docs in later phases.

## Phase 3 — Bulk tool porting (37 tools; office/formflow stay Phase 4/5)

Being done in waves rather than all at once — each wave is a reviewable, verified
slice rather than one giant unreviewed batch.

### Wave 1 — Tuning + Config (12 tools) — **done 2026-08-25**

The most uniform slice: every tool is "form in → generated config text out", a direct
fit for `ToolDetailScaffold`. Built the reference screen (`CephPgScreen.tsx`) by hand
first to nail the pattern — local state → `useMemo` wrapping `.execute()` in
try/catch → error as `text-destructive` → full generated text as `copyText` in a
`font-mono` block — then delegated the remaining 11 to 3 parallel background agents
(each building disjoint screen files only, no shared-file edits), followed by one
sequential pass wiring all 12 into `moduleTaxonomy.ts` (`route` field) and
`routes.tsx` together, avoiding the concurrent-edit conflict that would come from
agents fighting over the same two shared files.

- [x] Tuning: Linux Kernel Sysctl, Ceph PG Calculator, Database RAM Sizer, Monitoring
  Sizing (Zabbix), Firewall Command Builder.
- [x] Config: SSH Config Builder, Kernel Parameter Config Builder, Firewall Rule
  Builder, Docker Run → Compose, Crontab Builder, Chmod Calculator, Database Config
  Builder.
- [x] Verified: full `bun run build` (tsc -b + vite build) clean, full `bun run test`
  811/811 still passing, hex-boundary grep clean, and live in-browser smoke tests of
  3 screens covering the trickiest interaction logic — Ceph PG's live math, Chmod
  Calculator's checkbox-grid ⟷ octal ⟷ symbolic three-way sync (confirmed both
  directions), and Firewall Rule Builder's SSH-lockout `Alert` (confirmed it actually
  fires when a rule would drop port 22 under a default-deny policy — this tool's
  whole reason for existing).
- Notes for later waves: no accordion/collapsible or segmented-button shadcn
  component is installed — screens needing one used native `<details>`/`<summary>` or
  a manual `useState` toggle, and a plain two-`Button` pair standing in for a
  segmented control, respectively. Fine for now; revisit if a real primitive gets
  added later. `SysctlConfigBuilder.execute()` returns a bare string (no
  warnings/error object), unlike most other core files. Base UI's `Select`
  `onValueChange` types its value as `T | null` even in the non-multiple case — needs
  a `?? fallback` when forwarding to a plainly-typed setter.

### Wave 2 — Utilities module (21 tools) + Knowledge Hub (4 tools) — **done 2026-08-25**

Installed `Tabs`, `Table`, `Collapsible` shadcn components first (needed for the
combined multi-file screens and the tree viewer), then split the 25 tools across 4
parallel background agents — same pattern as Wave 1: agents build disjoint screen
files only, one sequential pass afterward wires `moduleTaxonomy.ts` + `routes.tsx`
together to avoid a shared-file edit race.

- [x] Crypto/security (6): SSH Key Pair Generator, Hash & Checksum, bcrypt Hash &
  Verify, X.509 Certificate Inspector, JWT Parser, htpasswd/Basic Auth Generator.
- [x] Network/identity (6): IPv4/IPv6 Subnet Calculator, MAC Address Tool, IPv4 Range
  & IPv6 ULA, Regex Tester & Explainer, UUID/ULID Generator, Password & Secret
  Generator.
- [x] Data/text incl. the two combined-tab screens (6): **Data Converter** (7 tabs —
  JSON/YAML/TOML/XML, Base64, URL, HTML Entities, Radix, Roman Numeral,
  Epoch↔ISO-8601 — wrapping `dataFormatConverter.ts` + `base64Converter.ts` +
  `webEncoders.ts` + `radixDateConverter.ts`), **Formatters** (4 tabs — JSON/XML/
  YAML/SQL, all four core classes share an identical `{source, mode}` →
  `{isValid, output?, errorMessage?}` shape so one parametrized hook covers all of
  them), Text & JSON Diff, JSONPath Evaluator, JSON/YAML Tree Viewer (recursive
  `Collapsible`-based tree, not flat text), JSON → CSV.
- [x] Remaining utilities (3) + Knowledge Hub (4): GZip Compress/Decompress, Base64
  File Converter (real `<input type="file">` + `arrayBuffer()`, browser
  Blob-download in place of Dart's native save dialog), Text Transformer,
  Cheatsheets, Documentation, Reference Lists, Study & Practice. The latter three
  share one new `ResourceLinkListView.tsx` component (search + tag filter + cards),
  built once and reused — mirrors `resource_link_list_view.dart`'s role in the
  Flutter version.
- [x] Verified: full `bun run build` clean (2396 modules, all 37 tools now bundled —
  gzip bundle is ~500KB, past Vite's 500KB chunk warning threshold; **route-based
  code-splitting via `React.lazy` is worth doing before Phase 7 packaging**, flagged
  here rather than fixed now since it's a perf concern, not a correctness one), full
  `bun run test` 811/811 still passing, hex-boundary grep clean, and live in-browser
  smoke tests: the Data Converter's JSON→YAML tab and its independent Roman-numeral
  tab (1994 → MCMXCIV, confirmed per-tab state doesn't leak), the Tree Viewer's
  recursive expand/collapse (confirmed a nested node's children render on click),
  and the Documentation screen's shared search/tag-filter component (typed "kernel",
  confirmed it narrowed to the one matching entry).
- Notes for later waves: no batch needed a new npm dependency. Non-deterministic
  core operations (SSH keygen draws fresh randomness, bcrypt draws a fresh salt)
  don't fit the pure `useMemo`-on-input-change pattern — handled with an explicit
  regenerate button / nonce dependency instead of silently recomputing every
  keystroke. Base UI's `Tabs`/`Select` `onValueChange` are loosely typed (`T | null`
  or similar) — the `(v) => setX((v as T) ?? fallback)` cast pattern recurs
  throughout; worth a small typed wrapper hook if Wave 3+ hits it enough to be worth
  deduplicating.

Each tool: one core file (already ported in Phase 1), one screen component, one
taxonomy entry, one route — per the pattern in `CLAUDE.md`.

### Remaining Phase 3 scope: none

All 37 tools outside Office/Media and FormFlow are now live. Phase 3 is complete —
only Phase 4 (Office & Media, 7 tools) and Phase 5 (FormFlow, 2 tools) remain before
the frontend port reaches full 44-tool parity with the Flutter app.

## Phase 4 — Office & Media suite — **done 2026-08-25**

Different from Phases 1-3: `office_media/` core logic was never ported (deliberately
excluded from Phase 1 since it needs binary-file libraries), so this phase did
core-port + screen-build together, one tool at a time, rather than as separate
passes. Built the reference tool by hand first — **Color Tools**
(`colorTools.ts`/`ColorToolsScreen.tsx`, pure math, no binary I/O, 13 tests) — wired
and verified solo before delegating the 6 binary-heavy tools to 3 parallel agents
grouped by shared library, then one sequential pass wiring all 7 into
`moduleTaxonomy.ts`/`routes.tsx`.

- [x] **PDF Split & Merge + PDF Inspector** — `pdf-lib` (not `pdfjs-dist` — `pdf-lib`
  alone covers both manipulation and metadata/page-count/encryption inspection, one
  dep instead of two). Caught a real `pdf-lib` trap: `PDFDocument.load()`/`.create()`
  default `updateMetadata: true`, silently overwriting Producer/ModificationDate on
  load — fixed with `{ updateMetadata: false }` everywhere, verified with a test that
  demonstrates the bug directly against raw `pdf-lib`. 29 tests, all against real
  in-test-built PDFs (no fixture files).
- [x] **Image Converter + EXIF Metadata Viewer** — Canvas API (`createImageBitmap` +
  `canvas.toBlob`) for conversion, no library needed; `exifr` for EXIF. Finding:
  Canvas's PNG encoder has no compression-effort knob at all (Dart's `package:image`
  had one) — quality slider disabled for PNG with an explanatory hint. Canvas's WebP
  encoder DOES support real lossy quality, unlike Dart's lossless-only WebP encoder —
  a genuine improvement. 27 tests covering all pure byte-math/validation logic; the
  actual Canvas-dependent encode/decode and `exifr.parse()` calls are untested since
  Vitest's default `node` environment has no DOM/Canvas — a deliberate, documented
  scope line, not an oversight.
- [x] **QR Code Suite + QR Code Reader** — `qrPayloadBuilder.ts` ported cleanly (pure
  string-building, no binary dependency, was just miscategorized as office_media
  rather than needing a real image lib) — 44 tests, direct port of the Dart test
  file. `qrcode` for generation, `jsqr` (not `zxing2`, unavailable in JS) for
  decoding — 16 more tests, including a real jsQR round-trip built by generating a
  QR PNG with the `qrcode` package inside the test itself and decoding it back, zero
  binary fixtures needed. `jsQR` has no error-correction-level reporting (dropped to
  `undefined`) and no rotation/skew retry pass (Dart's zxing2 had one) — both
  documented, not blocking.
- [x] Verified: full `bun run build` clean (2645 modules; gzip bundle now ~800KB —
  route-based code-splitting is increasingly worth doing, see the Phase 3 note, now
  more pressing with `pdf-lib`/`exifr`/`qrcode`/`jsqr` added), full `bun run test`
  940/940 passing, hex-boundary grep clean, all 7 screens confirmed rendering with
  zero console errors, and a real **end-to-end QR round trip**: generated a
  `https://example.com` QR in the browser, fed the resulting PNG into the QR Reader
  screen via a real `File`/`DataTransfer` simulated upload (not a mocked call), and
  confirmed it decoded back to the exact original URL with the correct "Web link
  details" structured breakdown.

## Phase 5 — FormFlow Dynamic Builder — **done 2026-08-25**

Highest-complexity module, built by hand end-to-end (not delegated to parallel
agents — only 2 tools, and the value is in one coherent design across the parser,
the recursive schema designer, and the recursive `useFieldArray`-driven live form).

- [x] `formFlowParser.ts` — ported `formflow_parser.dart`'s parse/render engine.
  Real simplification found during the port: `fast-xml-parser`'s default
  (non-`preserveOrder`) mode already collapses repeated same-name XML elements into
  an array and single occurrences into a plain object/scalar — the exact same shape
  `JSON.parse` and `js-yaml`'s `load` give for JSON/YAML. That meant detection AND
  rendering for all three formats could share one generic Map/Array/scalar
  tree-walker instead of needing a separate XML-element-tree code path the way the
  Dart original did (`package:xml`'s element tree wasn't already array-shaped for
  repeated tags). YAML rendering also got simpler: `js-yaml` has a real `dump()`
  encoder, so no need for the Dart version's hand-written block-style YAML writer.
  `XMLValidator.validate()` added (fast-xml-parser's `XMLParser` alone is lenient
  and won't throw on e.g. an unclosed tag) — same fix Phase 1's `xmlFormatter.ts`
  needed. 14/14 tests, a direct port of `formflow_parser_test.dart` plus one
  additional case.
- [x] `ISchemaRepository.ts` + `localStorageSchemaRepository.ts` — a minimal,
  deliberately narrow slice of Phase 6 (storage adapters) pulled forward, since
  "Custom Saved Templates" has no way to exist without persistence. Mirrors
  `web_schema_repository.dart`'s index-plus-per-key `localStorage` scheme exactly.
  **Not** a general `IStoragePort` implementation and **not** wired up for the
  Tauri desktop target — full Phase 6 (including the Tauri `fs`-backed adapter)
  remains open.
- [x] `FormFlowBuilderScreen.tsx` — schema designer (recursive field-type editor,
  object↔array retyping) + live interactive form driven by `react-hook-form`, using
  `useFieldArray` for every `array`/"Dynamic Array Loop" field — confirmed this is
  exactly why that library was chosen over alternatives back in the stack-decision
  phase. One documented, deliberate simplification vs. the Dart original: retyping
  any field resets that whole values tree to fresh defaults rather than surgically
  preserving unrelated sibling values across the retype (Dart's raw-mutable-Map
  approach could do the finer-grained thing; RHF's structured field-array model
  makes that materially harder for comparatively little benefit, since the typical
  workflow is design-the-shape-first, fill-in-data-second). PDF export
  (`pdf_form_generator.dart`) was **not** ported — it's not one of the taxonomy's 2
  FormFlow tools, a bonus feature in the Dart version, not required for parity.
- [x] `SavedTemplatesScreen.tsx` — list/load/delete against the same repository,
  "Load" passes the deserialized template to the builder via React Router's
  `navigate(path, {state})` (the equivalent of go_router's `extra`).
- [x] Verified live in-browser, not just typechecked — the full loop: parsed an XML
  config, retyped a field to a Dynamic Array Loop via the designer, added a second
  item via "+ Add Item", edited one item's value and confirmed the *other* item's
  value stayed untouched (per-index field isolation, the specific thing
  `useFieldArray` exists to get right), saved as a template, navigated away,
  reloaded it from Saved Templates, confirmed the schema/values/generated-output
  all restored byte-for-byte, then deleted it and confirmed the empty state.
  Also: full `bun run build` clean, full `bun run test` 954/954 passing,
  hex-boundary grep clean.

## Phase 6 — Storage adapters — **done 2026-08-25** (fs `dialog` plugin not included)

- [x] General `IStoragePort` (`get`/`set`/`remove`/`keys`, stubbed since Phase 0) now
  has two real implementations: `LocalStorageStoragePort` (web, every key namespaced
  under an `infrakit:` prefix so `keys()` never picks up anything else that might
  share the origin) and `TauriFsStoragePort` (desktop, `@tauri-apps/plugin-fs`
  scoped to `$APPDATA` via `src-tauri/capabilities/default.json`'s
  `fs:allow-appdata-*-recursive` permissions — added `tauri-plugin-fs` to
  `Cargo.toml` and registered it in `lib.rs`; `cargo check` compiles clean, which is
  a real compile-time validation of the capability permission identifiers since
  `generate_context!()` checks them against the plugin's schema). `createStoragePort()`
  picks between them via `@tauri-apps/api/core`'s `isTauri()` — same call site works
  unmodified on both targets.
- [x] FormFlow's `ISchemaRepository` refactored to sit on top of `IStoragePort`
  (composition, constructor-injected) instead of talking to `localStorage` directly
  the way the Phase-5 version did — the exact "worth deciding" question that
  section flagged. Same index-plus-per-key scheme as before
  (`formflow_template_names` + `formflow_template_<name>`), now automatically
  backed by whichever storage the runtime resolves to, no FormFlow-specific code
  changes needed to support desktop.
- [x] Module-prefs persistence (deferred since Phase 2) and theme-mode persistence
  (deferred since Phase 0) both wired via zustand's `persist` middleware, adapted to
  `IStoragePort` through a small `storagePortAsZustandStorage` shim
  (`app/src/adapters/storage/zustandStorage.ts`). Module-prefs persistence has a
  `merge` function that reconciles a saved `order`/`hiddenIds` snapshot against the
  *current* `moduleTaxonomy.ts` on load, so a module added/removed since the
  snapshot was saved doesn't vanish from the rail or break `visibleModulesInOrder`.
- **Not included**: the `dialog` plugin (native open/save file dialogs) — nothing
  in the app needs it yet; every file-handling tool so far uses `<input
  type="file">` + Blob-download, which works identically on web and in the Tauri
  webview with zero extra plugin surface. Add it if/when a tool specifically needs
  a native save-as dialog rather than a browser download.
- **Verified for the web target only** — full round trip confirmed live in-browser:
  toggled theme, hid a module via the rail's settings dialog, reloaded the page for
  real (not a SPA nav), confirmed both survived; saved a FormFlow template, watched
  the correctly-`infrakit:`-prefixed keys appear in `localStorage`, reloaded Saved
  Templates and confirmed it listed and loaded. **Not verified**: `TauriFsStoragePort`
  actually working inside a real desktop window — `cargo check` proves it compiles
  and the capability permissions are valid, but exercising the real file-write path
  needs an actual native window, which this environment can't open (same
  `tauri dev` limitation noted since Phase 0). Run `bun run tauri dev` yourself and
  check that theme/module-prefs/templates persist across an app restart to confirm.
- **No data migration path planned between the old Flutter app's storage and this
  one** — different origins/formats, and all data is regenerable user
  templates/prefs, not irreplaceable state.

## Phase 7 — Tauri packaging

- Icons, `tauri.conf.json` capabilities/permissions (least-privilege — only grant
  `fs`/`dialog` scopes tools actually need).
- Windows installer via Tauri's built-in bundler (MSI or NSIS), replacing the Inno
  Setup script in `packaging/windows/`.
- Web build: static output deployable as-is (replaces `flutter build web`); until the
  Go backend phase, no server-side piece is needed at all (simpler than the old
  `--serve` mode, which existed only to work around Flutter desktop/web packaging,
  not a requirement of the product itself).
- Linux packaging (`.deb`/AppImage equivalents) — same caveat as the original: untested
  without a Linux dev machine, budget for that when it comes up.
- End-to-end verification gate before calling this phase done: silent install → launch
  → uninstall cycle, same bar the original Windows packaging phase used
  (`README.md`'s Phase 5 note).

## Phase 8 — Go backend (separate epic, starts later, not part of this migration's critical path)

Explicitly deferred — do not start opportunistically mid-frontend-port:

- Ansible/ssh command execution service (`os/exec` + goroutines for concurrent runs).
- Local model serving (Ollama integration/proxy).
- Ships as a Tauri sidecar for desktop, standalone HTTP service for the web deployment.
- New "Automation"/"AI" modules in the taxonomy once this lands — out of scope for the
  frontend migration itself.

## Phase 9 — Retire the Flutter app

Only after React app reaches tool-for-tool parity and is verified against the
Flutter version (manual pass per module, not just "looks similar"):

- Archive `lib/`, `windows/`, `linux/`, `web/`, `pubspec.*` — move under e.g.
  `archive/flutter-app/` rather than deleting, in case of regressions found post-cutover.
- Update `README.md` to describe the new stack; keep `InfraKit Studio Specification.md`
  and `design.md` as-is (product spec and UI rationale are stack-agnostic) but add a
  note that implementation now lives in `src/` not `lib/`.

## Open questions

Resolved in Phase 0 — see that section above (repo layout, package manager, Cmd/Ctrl+K
search scope).
