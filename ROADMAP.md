# Roadmap — remaining work

One table of what's left, easy → hard. Detailed design lives in the linked
`*_PLAN.md` docs. Updated as items land.

Effort: **S** = hours · **M** = half-day+ · **L** = multi-day / grind.

| # | Task | What's left | Effort | Status |
|---|------|-------------|:---:|---|
| 1 | **A4e-2** tool transcript in saved chats ([AI_MCP_PLAN](AI_MCP_PLAN.md) §A4e) | done `2ff4522` — steps round-tripped (A3b) + token totals per conversation/turn | S | ✅ |
| 2 | **E3a** retry-from-toast ([ERROR_HANDLING_PLAN](ERROR_HANDLING_PLAN.md) §E3a) | done `e823421` — `{ retry }` opt on `reportError`, Retry button on retryable toasts, wired into llmStore mutations | S | ✅ |
| 3 | **A4e-1** MCP `list_changed` live refresh ([AI_MCP_PLAN](AI_MCP_PLAN.md) §A4e) | subscribe on the go-sdk session; drop the 60s tool cache on the notification | S | ☐ |
| 4 | **A3e** reliability polish ([AI_MODULE_PLAN](AI_MODULE_PLAN.md) §A3e) | Anthropic `cache_control` hint · per-connection concurrency cap · audit abort-releases-upstream | S–M | ☐ |
| 5 | **A3c** token-usage aggregation ([AI_MODULE_PLAN](AI_MODULE_PLAN.md) §A3c) | `llm_usage` table + engine `UsageRecorder` + `GET /llm/usage` grouped + AI Hub "Usage" view. **No cost/dollars.** | M | ☐ |
| 6 | **A4e-3** per-server MCP log / last-error ([AI_MCP_PLAN](AI_MCP_PLAN.md) §A4e) | surface a server's connection log + last error in the MCP view | M | ☐ |
| 7 | **E3b** error-history drawer ([ERROR_HANDLING_PLAN](ERROR_HANDLING_PLAN.md) §E3b) | `errorStore` history ring (cap 50) + a shell drawer with a count badge | M | ☐ |
| 8 | **S3a** per-section settings reset ([SETTINGS_MODULE_PLAN](SETTINGS_MODULE_PLAN.md) §S3) | "Reset this section" per panel — backend defaults + client clears | M | ☐ |
| 9 | **CS** `jsrsasign` → `@noble/*` ([CODE_SPLITTING_PLAN](CODE_SPLITTING_PLAN.md)) | swap the big crypto lib in the x509 / jwt tools; verify with real cert + JWT round trips | M | ☐ |
| 10 | **S3c** settings search ([SETTINGS_MODULE_PLAN](SETTINGS_MODULE_PLAN.md) §S3) | filter box over the settings registry | M | ☐ |
| 11 | **S3b** export / import all settings ([SETTINGS_MODULE_PLAN](SETTINGS_MODULE_PLAN.md) §S3) | one JSON blob (no secrets), merge-on-import | M | ☐ |
| 12 | **S3d** keyboard-shortcut editor ([SETTINGS_MODULE_PLAN](SETTINGS_MODULE_PLAN.md) §S3) | rebind UI + persisted map | M–L | ☐ |
| 13 | **E3c** migrate ~70 endpoints to `apierr` ([ERROR_HANDLING_PLAN](ERROR_HANDLING_PLAN.md) §E3c) | 4 batches: network read · utility power-mode · runbook sync · history | L | ☐ |
| 14 | **E3d** error wording / i18n scaffold ([ERROR_HANDLING_PLAN](ERROR_HANDLING_PLAN.md) §E3d) | one pass over `apierr` + `PRESETS` strings; extract to one file | M | ☐ |
| 15 | **E3e** per-source toast rate-limit ([ERROR_HANDLING_PLAN](ERROR_HANDLING_PLAN.md) §E3e) | collapse >3 errors/5s from one source into one toast | S | ☐ |

## Parked (need a trigger)

- **A3d** embeddings endpoint — build only when a RAG consumer is real
- **S3e** cross-device settings sync — needs an account layer
- **Packaging P7e–P7h** ([PACKAGING_PLAN](PACKAGING_PLAN.md)) — clean-VM gate, brand
  icons, web static deploy, Linux, release CI. **Paused by owner** until an
  installer is wanted.
- **MCP resources + prompts** — own follow-up after A4e

## Done (recent)

AI A0–A2, A3b, A4a–A4d, **A4e-2** · AI Stop · provider→model auto-fill ·
Gemini MCP fixes (`$schema` strip, `thoughtSignature` echo) · E0–E2 · S0–S2 ·
CS0–CS4 · P7a–P7d baseline · dialog-width fix · Tasks-view grouping.
