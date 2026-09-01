# Roadmap — remaining work

One table of what's left, easy → hard. Detailed design lives in the linked
`*_PLAN.md` docs. Updated as items land.

Effort: **S** = hours · **M** = half-day+ · **L** = multi-day / grind.

| # | Task | What's left | Effort | Status |
|---|------|-------------|:---:|---|
| 1 | **A4e-2** tool transcript in saved chats ([AI_MCP_PLAN](AI_MCP_PLAN.md) §A4e) | done `2ff4522` — steps round-tripped (A3b) + token totals per conversation/turn | S | ✅ |
| 2 | **E3a** retry-from-toast ([ERROR_HANDLING_PLAN](ERROR_HANDLING_PLAN.md) §E3a) | done `e823421` — `{ retry }` opt on `reportError`, Retry button on retryable toasts, wired into llmStore mutations | S | ✅ |
| 3 | **A4e-1** MCP `list_changed` live refresh ([AI_MCP_PLAN](AI_MCP_PLAN.md) §A4e) | done `e690581` — `ToolListChangedHandler` zeroes the cache-at so the next list re-fetches | S | ✅ |
| 4 | **A3e** reliability polish ([AI_MODULE_PLAN](AI_MODULE_PLAN.md) §A3e) | done `090b0fc` — Anthropic `cache_control` on long system blocks · per-conn concurrency cap (default 4) · abort-releases-upstream confirmed | S–M | ✅ |
| 5 | **A3c** token-usage aggregation ([AI_MODULE_PLAN](AI_MODULE_PLAN.md) §A3c) | done `4215a74` — `llm_usage` + `UsageRecorder` + `GET /llm/usage` grouped + AI Hub "Usage" tab (in/out bars, model/day/task). No cost. | M | ✅ |
| 6 | **A4e-3** per-server MCP status ([AI_MCP_PLAN](AI_MCP_PLAN.md) §A4e) | done `455bc8a` — `ServerStatus` per server (connected/toolCount/lastError), shown in McpView. **A4e complete** (item 4 = loop token totals fell out of A3c). | M | ✅ |
| 7 | **E3b** error-history drawer ([ERROR_HANDLING_PLAN](ERROR_HANDLING_PLAN.md) §E3b) | done `81f295c` — `history` ring (50) + header bell w/ unseen badge + drawer (expand, copy-all, clear) | M | ✅ |
| 8 | **S3a** per-section settings reset ([SETTINGS_MODULE_PLAN](SETTINGS_MODULE_PLAN.md) §S3) | done `66f9f18` — `SettingsResetButton` (2-click), wired into General/Runbooks/AI; Network already had one | M | ✅ |
| 9 | **CS** `jsrsasign` &rarr; `@peculiar/asn1-x509` ([CODE_SPLITTING_PLAN](CODE_SPLITTING_PLAN.md)) | done `65f2996` — x509Inspector rewritten on peculiar asn1 + noble hashes; 32 tests green; chunk 303KB&rarr;124KB raw | L | ✅ |
| 10 | **S3c** settings search ([SETTINGS_MODULE_PLAN](SETTINGS_MODULE_PLAN.md) §S3) | done `a20663e` — nav search box, per-section `keywords` | M | ✅ |
| 11 | **S3b** export / import all settings ([SETTINGS_MODULE_PLAN](SETTINGS_MODULE_PLAN.md) §S3) | done `e7d182a` — `settingsBackup.ts` + General "Backup" group; no secrets, merge-on-import | M | ✅ |
| 12 | **S3d** keyboard-shortcut editor ([SETTINGS_MODULE_PLAN](SETTINGS_MODULE_PLAN.md) §S3) | done `2f7eece` — `core/shortcuts/` registry + `useShortcut` + General "Keyboard shortcuts" rebind UI; migrated ⌘S/⌘↵ | M–L | ✅ |
| 13 | **E3c** migrate ~70 endpoints to `apierr` ([ERROR_HANDLING_PLAN](ERROR_HANDLING_PLAN.md) §E3c) | done `ab75c23`·`1ba9c4b`·`470bc16`·`160dd4e` — 4 batches + `apierr.Unavailable()` + `backend.yml` grep guard | L | ✅ |
| 14 | **E3d** error wording / i18n scaffold ([ERROR_HANDLING_PLAN](ERROR_HANDLING_PLAN.md) §E3d) | done `b31b977` — `errorStrings.ts` map + wording pass (both sides) | M | ✅ |
| 15 | **E3e** per-source toast rate-limit ([ERROR_HANDLING_PLAN](ERROR_HANDLING_PLAN.md) §E3e) | done `c26e2b0` — >3/5s from one source → one "Multiple errors" toast; history keeps all | S | ✅ |

## Parked (need a trigger)

- **A3d** embeddings endpoint — build only when a RAG consumer is real
- **S3e** cross-device settings sync — needs an account layer
- **Packaging P7e–P7h** ([PACKAGING_PLAN](PACKAGING_PLAN.md)) — clean-VM gate, brand
  icons, web static deploy, Linux, release CI. **Paused by owner** until an
  installer is wanted.
- **MCP resources + prompts** — own follow-up after A4e

## Remaining

All 15 done. **E3 complete.** Only the parked items are left (see below).

## Done

AI A0–A2 · **A3b/A3c/A3e** · A4a–A4d · **A4e (complete)** · AI Stop ·
provider→model auto-fill · Gemini MCP fixes (`$schema` strip,
`thoughtSignature` echo) · E0–E2 · **E3a/E3b/E3e** · S0–S2 · **S3a/S3b/S3c** ·
**E3c/E3d** · **E3 complete** · CS0–CS4 · **jsrsasign→peculiar** · P7a–P7d
baseline · dialog-width fix · Tasks-view grouping.
