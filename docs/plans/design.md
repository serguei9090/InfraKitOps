# InfraKit Studio — UI/UX Design Notes

> **Note (2026-08-25):** the implementation has moved from Flutter (`lib/**`, now
> archived to `archive/flutter-app/`) to React (`app/src/**`) — see `CLAUDE.md` and
> `MIGRATION_PLAN.md`. The rules and rationale below are UI-framework-agnostic and
> still apply; file paths referencing `lib/adapters/ui/**` now mean the equivalent
> file under `app/src/adapters/ui/**`.

Working notes on the shell's visual and navigational design — the *why* behind
`lib/adapters/ui/shell/**`, not a restatement of the product spec (see
`InfraKit Studio Specification.md` for the module taxonomy and wireframes this builds on).

## Visual style

`lib/adapters/ui/shell/app_theme.dart` defines one Material 3 theme (light + dark
variants) applied globally via `MaterialApp.router`. Goal: read as a premium dev tool
(Linear/Vercel-style), not stock Material.

- **Seed color**: `Color(0xFF4F46E5)` (indigo), via `ColorScheme.fromSeed`.
- **Cards**: flat (`elevation: 0`) with a hairline `outlineVariant` border and 16px
  radius, instead of Material's default drop-shadow elevation.
- **Type scale**: tightened letter-spacing and heavier weights on headings
  (`AppTheme._textTheme`) versus default Material spacing.
- **Monospace**: `AppTheme.monospace` is the shared text style for generated
  code/config output panels (`fontFamily: 'monospace'` with platform fallbacks —
  no bundled font asset, keeps the app fully offline/local-first with zero network
  font fetches).
- Hover states on cards animate a small upward translation + border color shift
  (`ToolCard` in `module_section_view.dart`) rather than Material's ripple-only default.

### Selected-state convention

**Rule: any "this row/icon is the currently active one" indicator uses
`AppTheme.selectedIndicatorColor(scheme)` (a 40%-alpha `primaryContainer`) and
`AppTheme.selectedIndicatorRadius` (10px). Never invent a one-off selected color or
radius in a new screen.**

Why this is called out explicitly: it drifted once already. The rail's selected-icon
box, the swap pane's selected tool row, and `CheatsheetsScreen`'s internal page list
were each built at different times (some by background agents with no visibility into
the others) and ended up with three slightly different selected-row treatments — a
solid-color rounded box, a full-width unrounded `ListTile` fill, and a different alpha
value. Fixed by:

- Setting `listTileTheme.selectedTileColor`/`shape` globally in `app_theme.dart`, so
  **any** `ListTile(selected: true)` anywhere in the app gets the standard look for
  free — no per-screen styling needed, so it can't drift again.
- The rail's selected-icon box isn't a `ListTile` (it's a custom `Container`, since it's
  a square icon button, not a list row), so it reads `AppTheme.selectedIndicatorColor`/
  `selectedIndicatorRadius` directly instead of hardcoding its own values.

If a future screen needs a selected/active indicator that genuinely can't be a
`ListTile`, pull the color/radius from those two `AppTheme` members rather than
picking new ones.

## Navigation model

Three iterations happened in-session before landing here — recorded because the
reasoning matters more than the end state if this gets revisited:

1. **Flat `NavigationRail`** (Phase 0 scaffold): top-level module icons only, no way to
   see individual tools without picking a module first. Fine for 5 modules, wouldn't
   scale.
2. **Persistent expandable tree** (first revision): every module + every tool listed in
   one scrollable `ExpansionTile` tree, always all visible. Matches the DevToys
   reference the user shared. Rejected once a second design question surfaced: this
   grows tall fast as more modules (AI, Ansible, ...) and tools get added — no way to
   focus on one module without scrolling past the rest.
3. **Icon rail + swap pane** (current): a narrow, fixed-width icon-only rail
   (`_ModuleRail` in `app_sidebar.dart`) is *always* visible and never grows — it's one
   icon per module regardless of how many modules exist. Clicking an icon swaps the
   adjacent pane (`_ToolListPane`) to that module's tool list in place. No back button;
   switching modules is always exactly one click; the active module is always visible
   via the highlighted icon. This is the VSCode/Slack activity-bar pattern, chosen
   specifically because it scales in module *count* without growing vertically, which
   the tree approach didn't.

### The two content pages

- **Page 1 — `/` ("All Tools")**: `HomeDashboardScreen`. Every visible module, stacked,
  each as a card grid (`ModuleSectionView`). The browsing/landing view.
- **Page 2 — `/modules/:id`**: `ModuleToolsScreen`. One module's card grid only —
  what you land on after clicking a module in the rail. Reuses the exact same
  `ModuleSectionView` widget as page 1 (`linkHeaderToModulePage: false` so the header
  isn't a redundant self-link), so the two pages can never visually drift apart.
- Individual tool routes (`/tools/*`) render inside the same persistent shell
  (`ShellRoute` in `app_shell.dart`) — the rail and swap pane never unmount while
  navigating between tools, only `AppShellScaffold`'s content slot changes.

### Module prefs (rearrange/hide)

`module_visibility_provider.dart` holds a `ModulePrefs { order, hiddenIds }` Riverpod
`StateNotifier`, edited via the gear button at the bottom of the rail
(`ModuleSettingsDialog` — drag to reorder, checkbox to hide). Both the rail and the
page-1 overview read through `visibleModulesInOrder(prefs)` rather than
`kModuleTaxonomy` directly, so hide/reorder applies everywhere consistently.

**Known limitation**: prefs are in-memory only (reset on restart). Persisting them
through `IStoragePort` is deferred, not forgotten — it's the same storage port Phase 3's
FormFlow template library needs, so it's natural to wire both at once rather than
building a one-off persistence path just for this dialog.

## Knowledge Hub: four tools, not one with tabs

Module 5 was originally one tool ("Cheatsheets & Documentation Hub") with an internal
tab list that lumped together five different kinds of content: quick command
lookups, official docs, curated "awesome-X" link collections, and hands-on
exercises/roadmaps. The user's own framing, corrected after I first misread the ask:
these aren't variations on "cheatsheet," they're categorically different — what's
for a *quick syntax lookup* (cheatsheet), what's *the authoritative doc* (documentation),
what's *a curated pointer to browse* (reference list), and what's *meant to be worked
through* (study/practice) are different tasks with different UX needs. Burying three
of those four inside one screen's tab bar made the distinction invisible until you'd
already drilled in.

Fixed by splitting module 5 ("Knowledge Hub") into four separate sidebar-visible tools,
each its own screen:

- `CheatsheetsScreen` (`/tools/cheatsheets`) — the original 5 quick-reference pages
  (Git, Regex, Sysctl, Crontab, Chmod). Unchanged in content, just no longer shares a
  screen with the other three.
- `DocumentationScreen` / `ReferenceListsScreen` / `StudyPracticeScreen` — each a thin
  wrapper filtering `kExternalResourceLinks` by `ResourceType` and passing the subset to
  a shared `ResourceLinkListView` (`resource_link_list_view.dart`), which owns the
  search box, tag-chip filter, and card rendering once instead of three times.
  `StudyPracticeScreen` sets `groupByType: true` since it covers two types (exercise +
  roadmap) that are still worth telling apart within that one screen; the other two
  cover a single type each, so no sub-grouping needed.

The `ResourceType`/`tags` data model in `cheatsheet_content.dart` didn't need to
change for this — it already had the right categorization; only the UI's grouping
was wrong.

## Component reuse (why adding a tool is a 2-file, 2-line change)

- `ToolDetailScaffold` (`tool_detail_scaffold.dart`) — the input/output split-panel
  layout every tool screen builds on (spec's Wireframe 2). Owning this centrally means
  every tool screen — whether built by hand or by a parallel background agent with zero
  visibility into any other tool — looks and behaves consistently without coordination.
- `ModuleSectionView` / `ToolCard` (`module_section_view.dart`) — the card grid, shared
  by both content pages (see above).
- Registering a new tool touches exactly two shared files
  (`module_taxonomy.dart` for the sidebar/overview entry, `app_shell.dart` for the
  route) — everything else (core logic, screen) lives in its own new file. This is
  deliberate: it's what let four unrelated background agents build Phase 1/2 tools
  fully in parallel with zero file conflicts, with only those two registries needing a
  manual integration pass afterward.
