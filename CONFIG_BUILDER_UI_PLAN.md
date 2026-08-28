# Config-builder UI: the "Generator" archetype (T5)

Status: **done (2026-08-28)** — phases A–F on branch `config-catalog-editor`.
Follows the `DirectiveCatalogEditor` extraction on the same branch.

**Result:** T5 `GeneratorScaffold` + `HeaderValidate`; 9 file generators
migrated (RDP, SSH, Sysctl, Zabbix, Web Server, Database, Fail2ban, Firewall
Rule; Crontab → T1 instead). `ConfigValidateButton` deleted. `bun run build`
clean, 1079 tests pass, hex boundary intact.

**Reclassified during the work:** **Firewall Command Builder** stays on T2 —
its output is a set of per-rule Add/Remove one-liners with inline warnings,
not a single saved file, and that structured breakdown is worth seeing while
you build. Not a "generator" in the T5 sense.

## Problem

The "fill a form → generate a config file" tools are spread across three
layout archetypes and none of them fit well:

| tool | scaffold | symptom |
|---|---|---|
| RDP File Builder | T1 ToolDetail | right half is a near-empty preview while you fill the left — wasted space |
| Database Config Builder | T2 BalancedFlow | header has **Copy only** — no Download, no Preview; the 3-panel split reads as "one panel is empty" |
| Web Server / Fail2ban / Firewall Command | T2 BalancedFlow | same — no Download/Preview, misused "results" panel |
| Firewall Rule Builder | T3 Stepper | stepper "3 Review" lights from load (same misfire we hit on RDP), no Download |
| SSH / Sysctl / Zabbix | T1 (just migrated) | same wasted-space issue as RDP |

Common truth: **you don't need to watch the generated file while filling the
form.** The file is a *result* — reach for it when you're done (copy /
download / glance), not a second editor pane.

Also: validation (`nginx -t`, `sshd -t`, `nft -c`, …) is currently a button
buried at the bottom of an output panel. It belongs in the header next to
Copy/Download as a first-class "is this correct?" affordance.

## Decision

A new archetype **T5 `GeneratorScaffold`** — single-column form, output on
demand:

```
┌ Header:  Title .................. [✓ Validate] [⬇ Download] [👁 Preview] [⧉ Copy] ┐
├──────────────────────────────────────────────────────────────────────────────────┤
│  single-column form, full width, scrolls                                         │
│   · toolbar slot (mode switches, engine picker, …)                               │
│   · the body: <DirectiveCatalogEditor> or bespoke form fields                    │
│   · inline errors from execute() (blocking) shown here                           │
└──────────────────────────────────────────────────────────────────────────────────┘
     Preview (modal): the generated file, monospace, scroll, with its own
     Download + Copy and any execute() advisory warnings.
```

- Built on the **same `ToolScaffoldHeader` + `ToolScaffoldPanel` primitives**
  as T1–T3 — it is a real archetype in `adapters/ui/shell/`, not a one-off,
  and stays visually consistent.
- `ToolScaffoldHeader` already renders `preview` (Dialog) + `download` +
  `copyText`. **New:** a `validate?: { kind: ConfigCheckKind; text: string }`
  prop → a compact header control (reusing `ConfigValidateButton`'s backend
  call + state machine), popover for the error list. Renders nothing when the
  backend isn't connected — same rule as today.
- `DirectiveCatalogEditor` is the standard body for catalog builders; bespoke
  forms (Web Server, Database) pass their own fields as the body.

### Validate control states

| state | header shows |
|---|---|
| idle | `Validate` (outline) |
| checking | `Validate` + spinner, disabled |
| valid | `✓ Valid` (green), auto-reverts to idle after ~4 s |
| invalid | `✕ N issue(s)` (red) → click opens a popover with the messages |
| backend error | `✕ Validator unavailable` → popover with the reason |

Non-blocking: a config still generates, copies, and downloads while invalid —
the validator is advice, not a gate.

## Migration

| tool | now | → | validate kind |
|---|---|---|---|
| RDP File Builder | T1 | **T5** | — |
| SSH Config Builder | T1 | **T5** | `ssh` / `sshd` (by mode) |
| Sysctl Config Builder | T1 | **T5** | `sysctl` |
| Zabbix Config Builder | T1 | **T5** | — |
| Web Server Config Builder | T2 | **T5** | `nginx` |
| Database Config Builder | T2 | **T5** | — |
| Fail2ban Jail Config Builder | T2 | **T5** | `fail2ban` |
| Firewall Command Builder | T2 | **T5** | — |
| Firewall Rule Builder | T3 | **T5** (drop stepper) | `nftables` |
| Crontab Builder | T2 | **T1** — keeps a real results view (next-run times), not just a file | — |

**Stay as they are:**
- **Chmod Calculator** (T1) — live bidirectional octal⟷symbolic⟷grid editing; output *is* the interaction.
- **Docker Run → Compose** (T1) — paste input on the left, want the converted output beside it.
- **Sizers** — DB RAM Sizer, Zabbix Sizer, Ceph PG (T2 BalancedFlow) — genuine computed *results* (numbers, tables) alongside a snippet. T2 is correct for these; T5 is not.

## Open question (Crontab)

Crontab Builder produces both a cron expression *and* a "next 5 run times"
list — that list is a result you read while editing, not a downloadable file.
Options:
1. **T1** — expression form left, next-runs + explanation right. (recommended)
2. **T5** with the next-runs list inline in the form body, expression behind Preview.

Recommend 1 — it's genuinely a two-view tool, unlike the pure file generators.

## Phases

| phase | scope | commit |
|---|---|---|
| **A** | `ToolScaffoldHeader` gains `headerActions`; `GeneratorScaffold.tsx` (T5); `HeaderValidate.tsx` | `6ec4556` |
| **B** | RDP + SSH + Sysctl + Zabbix: T1 → T5 (SSH/Sysctl get the header Validate action) | `6ec4556`, `5ef7e86` |
| **C** | Database + Web Server + Fail2ban: T2 → T5 (Firewall Command reclassified — stays T2) | `96324b0` |
| **D** | Firewall Rule Builder: T3 → T5, stepper dropped | `9087795` |
| **E** | Crontab Builder: T2 → T1 (it's genuinely a two-view tool, not a generator) | `9087795` |
| **F** | `ConfigValidateButton` deleted (its logic now lives in `HeaderValidate`) | — |

Every phase: `bun run build` + `bun run test` green, `grep -rl "from 'react'
app/src/core` empty, each migrated screen verified in-browser (form fills,
Preview modal shows the file, Download + Copy work, Validate reflects a good
and a bad config where a `kind` applies).

## Not in scope

- T2 BalancedFlow and T3 Stepper stay — T2 for sizers/calculators, T3 for
  genuine row-by-row workflows (PDF Split & Merge). This plan only moves the
  *file generators* off them.
- No change to `src/core/**` — every `execute()` and its tests are untouched.
