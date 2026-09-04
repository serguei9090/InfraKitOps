# Roadmap — remaining work

One table of what's left, easy → hard. Detailed design lives in the linked
`*_PLAN.md` docs. Updated as items land.

Effort: **S** = hours · **M** = half-day+ · **L** = multi-day / grind.

| # | Task | What's left | Effort | Status |
|---|------|-------------|:---:|---|
| 1 | **A4e-2** tool transcript in saved chats ([AI_MCP_PLAN](docs/plans/AI_MCP_PLAN.md) §A4e) | done `2ff4522` — steps round-tripped (A3b) + token totals per conversation/turn | S | ✅ |
| 2 | **E3a** retry-from-toast ([ERROR_HANDLING_PLAN](docs/plans/ERROR_HANDLING_PLAN.md) §E3a) | done `e823421` — `{ retry }` opt on `reportError`, Retry button on retryable toasts, wired into llmStore mutations | S | ✅ |
| 3 | **A4e-1** MCP `list_changed` live refresh ([AI_MCP_PLAN](docs/plans/AI_MCP_PLAN.md) §A4e) | done `e690581` — `ToolListChangedHandler` zeroes the cache-at so the next list re-fetches | S | ✅ |
| 4 | **A3e** reliability polish ([AI_MODULE_PLAN](docs/plans/AI_MODULE_PLAN.md) §A3e) | done `090b0fc` — Anthropic `cache_control` on long system blocks · per-conn concurrency cap (default 4) · abort-releases-upstream confirmed | S–M | ✅ |
| 5 | **A3c** token-usage aggregation ([AI_MODULE_PLAN](docs/plans/AI_MODULE_PLAN.md) §A3c) | done `4215a74` — `llm_usage` + `UsageRecorder` + `GET /llm/usage` grouped + AI Hub "Usage" tab (in/out bars, model/day/task). No cost. | M | ✅ |
| 6 | **A4e-3** per-server MCP status ([AI_MCP_PLAN](docs/plans/AI_MCP_PLAN.md) §A4e) | done `455bc8a` — `ServerStatus` per server (connected/toolCount/lastError), shown in McpView. **A4e complete** (item 4 = loop token totals fell out of A3c). | M | ✅ |
| 7 | **E3b** error-history drawer ([ERROR_HANDLING_PLAN](docs/plans/ERROR_HANDLING_PLAN.md) §E3b) | done `81f295c` — `history` ring (50) + header bell w/ unseen badge + drawer (expand, copy-all, clear) | M | ✅ |
| 8 | **S3a** per-section settings reset ([SETTINGS_MODULE_PLAN](docs/plans/SETTINGS_MODULE_PLAN.md) §S3) | done `66f9f18` — `SettingsResetButton` (2-click), wired into General/Runbooks/AI; Network already had one | M | ✅ |
| 9 | **CS** `jsrsasign` &rarr; `@peculiar/asn1-x509` ([CODE_SPLITTING_PLAN](docs/plans/CODE_SPLITTING_PLAN.md)) | done `65f2996` — x509Inspector rewritten on peculiar asn1 + noble hashes; 32 tests green; chunk 303KB&rarr;124KB raw | L | ✅ |
| 10 | **S3c** settings search ([SETTINGS_MODULE_PLAN](docs/plans/SETTINGS_MODULE_PLAN.md) §S3) | done `a20663e` — nav search box, per-section `keywords` | M | ✅ |
| 11 | **S3b** export / import all settings ([SETTINGS_MODULE_PLAN](docs/plans/SETTINGS_MODULE_PLAN.md) §S3) | done `e7d182a` — `settingsBackup.ts` + General "Backup" group; no secrets, merge-on-import | M | ✅ |
| 12 | **S3d** keyboard-shortcut editor ([SETTINGS_MODULE_PLAN](docs/plans/SETTINGS_MODULE_PLAN.md) §S3) | done `2f7eece` — `core/shortcuts/` registry + `useShortcut` + General "Keyboard shortcuts" rebind UI; migrated ⌘S/⌘↵ | M–L | ✅ |
| 13 | **E3c** migrate ~70 endpoints to `apierr` ([ERROR_HANDLING_PLAN](docs/plans/ERROR_HANDLING_PLAN.md) §E3c) | done `ab75c23`·`1ba9c4b`·`470bc16`·`160dd4e` — 4 batches + `apierr.Unavailable()` + `backend.yml` grep guard | L | ✅ |
| 14 | **E3d** error wording / i18n scaffold ([ERROR_HANDLING_PLAN](docs/plans/ERROR_HANDLING_PLAN.md) §E3d) | done `b31b977` — `errorStrings.ts` map + wording pass (both sides) | M | ✅ |
| 15 | **E3e** per-source toast rate-limit ([ERROR_HANDLING_PLAN](docs/plans/ERROR_HANDLING_PLAN.md) §E3e) | done `c26e2b0` — >3/5s from one source → one "Multiple errors" toast; history keeps all | S | ✅ |

## Parked (need a trigger)

- **Packaging** ([PACKAGING_PLAN](docs/plans/PACKAGING_PLAN.md)) — **release CI done**
  (`release.yml`: tag `v*` → draft Release with Windows MSI/NSIS + Linux
  deb/AppImage desktop installers **and** self-contained
  `infrakit-studio-web-<v>-{linux,windows}-amd64.zip` bundles that serve
  UI+API from one binary). **Hosted web deployment done** (DEPLOY_PLAN D0–D5,
  Docker + compose). Remaining, owner-paused: brand icons, code signing
  (needs certs), macOS, P7e clean-VM install/UAC/uninstall gate.
- **A4f `Task.resources`** — always-inject resource URIs per task
  ([MCP_RESOURCES_PROMPTS_PLAN](docs/plans/MCP_RESOURCES_PROMPTS_PLAN.md) §7). Interactive
  attach shipped; this is the "pin it to a task" extra.
- **Security module — file encryption tool** (2026-09-04, not started, build
  only when explicitly asked). Client-only utility, same pattern as the
  other 44 tools: encrypt/decrypt a dropped file with a passphrase using the
  browser's Web Crypto API (AES-256-GCM, PBKDF2/Argon2-ish KDF from the
  passphrase) — no backend needed, fits `ToolDetailScaffold` (T1). Natural
  home is a new `security` rail module or folded into an existing one
  (Utilities?) — decide at build time. Distinct from the existing
  server-side **Vault** (secrets storage for runbooks/AI keys/SSH — a
  different feature, not a file-encryption tool) and from `pdf-inspector`'s
  encryption *status* read. Could grow later into other client-side crypto
  utilities (checksum/sign a file, etc.) if asked, but scope stays exactly
  "encrypt/decrypt a file with a passphrase" until requested otherwise.

## Killed (won't build)

- **A3d** embeddings — no DB, no RAG consumer, and this is a standalone app.

## Remaining

All 15 numbered items + A4f + S3f done. **User management module U0–U6 done**
([`USER_MANAGEMENT_PLAN.md`](docs/plans/USER_MANAGEMENT_PLAN.md)) — multi-tenant auth,
opt-in `--auth on` (off by default, solo unchanged). Only parked items left:

- **S3e** cross-device settings sync — now buildable on the U-module account
  layer; unpark only if requested.
- Tauri desktop custom-cert verifier for a desktop app pointed at a remote
  HTTPS backend (U6 deferred — the loopback sidecar needs no TLS).
- Packaging P7e–P7h (owner-paused).

## Done

AI A0–A2 · **A3b/A3c/A3e** · A4a–A4d · **A4e (complete)** ·
**A4f (MCP resources + prompts)** · AI Stop · provider→model auto-fill ·
Gemini MCP fixes (`$schema` strip, `thoughtSignature` echo) · E0–E2 ·
**E3a–E3e (E3 complete)** · S0–S2 · **S3a–S3d** · **S3f** · CS0–CS4 ·
**jsrsasign→peculiar** · P7a–P7d baseline · dialog-width fix ·
Tasks-view grouping.
