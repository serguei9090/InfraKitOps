# Knowledge Hub — AI & Automation expansion plan

Status: **done (2026-08-28)** — phases A–F complete on branch
`knowledge-hub-ai-expansion`. Adds AI/automation resource categories to the
Knowledge Hub module, a link-health check script, and a one-off importer for
GitHub stars. Client-only — no backend, same constraint as the rest of the
Knowledge Hub.

**Result:** 8 new screens in a `Knowledge Hub → AI & Automation` group,
205 curated links (all liveness-checked, 0 dupes), `bun run check:links` +
weekly CI, `bun run import:stars`. `bun run build` clean, 1052 Vitest tests
pass, `src/core` hex boundary intact. Not yet done: pushing the branch /
opening a PR (awaiting user), and reviewing the remaining ~640 star
candidates in `app/scripts/out/github-stars-candidates.json`.

### Decisions (2026-08-28)

1. **Structure** — new `'AI & Automation'` group *inside* the existing Knowledge
   Hub module. No new rail icon / standalone module.
2. **Hosting/tunnel/PaaS links** — get their own new category
   `'Dev Services & Hosting'` (`type: 'devService'`), not folded into Reference
   Lists. Card links to each product's main site.
3. **Depth** — curated ~150 links for the first delivery. `awesome-*` repos are
   linked as directories (`isDirectory: true`), not scraped into entries.
4. **AI Models screen** — static curated links only. No runtime leaderboard
   fetch; the whole Hub stays offline.
5. Every card is the existing `ResourceLinkListView` card — name, description,
   tags, link to the tool's main site.

Related: [`design.md`](design.md) §"Knowledge Hub: four tools, not one with
tabs", [`NETWORK_MODULE_PLAN.md`](NETWORK_MODULE_PLAN.md) (phase-doc format
this follows).

---

## 1. What the user asked for

New Knowledge Hub sub-modules:

- **MCP servers** — servers, gateways, registries
- **AI Skills** (SKILL / agent skills) — SKILL.md ecosystems, skill marketplaces
- **AI Software** — end-user AI apps / agents
- **AI Frameworks / AI dev** — agent & AI dev SDKs (Google ADK-style, Pydantic AI, …)
- **Automation** — automation platforms & workflow tools

Plus:

- Catalog / directory links for every one of the above.
- Top AI directory sites, tagged.
- The user's ~130 stored URLs folded in, deduped against what's already there.
- GitHub starred repos with an AI-ish topic pulled in.
- Top-10 world models + their tools/harnesses.
- A script that checks every URL is live and flags duplicates.

---

## 2. How the Knowledge Hub works today (so the change stays mechanical)

One data file drives everything:
[`app/src/core/cheatsheets/cheatsheetContent.ts`](app/src/core/cheatsheets/cheatsheetContent.ts)

- `ResourceType` union + `RESOURCE_TYPES` ordering array
- `EXTERNAL_RESOURCE_LINKS: ReferenceLink[]` — `{ name, url, description, type, tags }`
- One thin screen per "kind", each filters `EXTERNAL_RESOURCE_LINKS` by `type`
  and hands the subset to the shared
  [`ResourceLinkListView.tsx`](app/src/adapters/ui/tools/ResourceLinkListView.tsx)
  (owns search box + tag chips + card grid)
- Register a screen: 1 entry in
  [`moduleTaxonomy.ts`](app/src/adapters/ui/shell/moduleTaxonomy.ts) + 1 route in
  [`routes.tsx`](app/src/routes.tsx)
- Structural tests: [`cheatsheetContent.test.ts`](app/src/core/cheatsheets/cheatsheetContent.test.ts)

`src/core/**` stays React-free — this file already is, keep it that way.

---

## 3. Data-model change

Extend `ReferenceLink` and `ResourceType` in `cheatsheetContent.ts`. Additive
only — every existing entry keeps working.

```ts
export type ResourceType =
  // existing (infra)
  | 'documentation' | 'curatedList' | 'exercise' | 'roadmap'
  // new
  | 'catalog'      // a directory/aggregator of many tools (AI tool lists, model indexes)
  | 'mcpServer'    // MCP servers, gateways, registries
  | 'aiSkill'      // agent-skill ecosystems, SKILL.md, skill marketplaces
  | 'aiFramework'  // agent / AI-dev frameworks & SDKs
  | 'aiApp'        // end-user AI software / agents / products
  | 'aiModel'      // a foundation model + its official tooling/harness
  | 'automation'   // automation platforms & workflow engines
  | 'devService'   // hosted infra products: tunnels, static hosts, PaaS, deploy platforms

export interface ReferenceLink {
  name: string
  url: string
  description: string
  type: ResourceType
  tags: string[]
  /**
   * True when the link is itself an index/directory/aggregator rather than a
   * single project. Screens render an "Catalogs & directories" band first,
   * then the rest. Lets the dedicated /tools/ai-catalogs screen collect every
   * directory across types without a separate type per domain.
   */
  isDirectory?: boolean
}
```

Decision — **one boolean (`isDirectory`) + a `catalog` type, not a domain enum.**
`catalog` type is for cross-cutting "there's an AI for that" style sites that
don't belong to one sub-module. `isDirectory` marks the registry/index entries
that DO belong to a sub-module (e.g. `registry.modelcontextprotocol.io` is
`type: 'mcpServer', isDirectory: true`) so each sub-screen can surface its own
catalogs. AI vs infra separation is by `tags` (`ai`, `agents`, `llm`, `mcp`),
not a new field — matches how the existing data already tags topics.

`RESOURCE_TYPES` array gets the new values appended in display order (infra
first, then `catalog`, `mcpServer`, `aiFramework`, `aiApp`, `aiSkill`,
`automation`, `aiModel`, `devService`).

---

## 4. New screens & sidebar

Knowledge Hub currently has 4 ungrouped tools. Add a `group` to those 4
(`'Reference'`) and add a second group `'AI & Automation'` with 8 screens.
(Grouped-sidebar rendering is already used by other modules — recent commits.)

| id             | route                  | filter                         | screen file                  |
|----------------|------------------------|--------------------------------|------------------------------|
| ai-catalogs    | `/tools/ai-catalogs`   | `isDirectory` && ai/automation tags | `AiCatalogsScreen.tsx`  |
| mcp-servers    | `/tools/mcp-servers`   | `type === 'mcpServer'`         | `McpServersScreen.tsx`       |
| ai-frameworks  | `/tools/ai-frameworks` | `type === 'aiFramework'`       | `AiFrameworksScreen.tsx`     |
| ai-software    | `/tools/ai-software`   | `type === 'aiApp'`             | `AiSoftwareScreen.tsx`       |
| ai-skills      | `/tools/ai-skills`     | `type === 'aiSkill'`           | `AiSkillsScreen.tsx`         |
| automation     | `/tools/automation`    | `type === 'automation'`        | `AutomationScreen.tsx`       |
| ai-models      | `/tools/ai-models`     | `type === 'aiModel'`           | `AiModelsScreen.tsx`         |
| dev-services   | `/tools/dev-services`  | `type === 'devService'`        | `DevServicesScreen.tsx`      |

Each screen is a ~20-line wrapper — copy `DocumentationScreen.tsx` verbatim,
swap the `TYPE`, title, and description. `AiCatalogsScreen` filters on
`isDirectory` instead of `type`. No new component — `ResourceLinkListView`
handles all of it. Add the new `ResourceType` → label mappings to
`TYPE_LABELS` in `ResourceLinkListView.tsx`.

Optional polish (phase 2): teach `ResourceLinkListView` to render an
`isDirectory` band at the top of any screen ("Catalogs & directories" then
"Projects"). Small change, not required for the first cut.

Icons (lucide-react, already the icon set): `LibraryBig` (catalogs),
`ServerCog` / `Plug` (MCP), `Boxes` (frameworks), `Sparkles` / `Bot` (AI
software), `Wand2` (skills), `Workflow` (automation), `BrainCircuit` (models),
`Cloud` / `Tent` (dev services).

---

## 5. Seed content

### 5.1 Dedupe first — user URLs already in `EXTERNAL_RESOURCE_LINKS`

These 28 from the user's list are **already present** — do not re-add
(the check script §7 enforces this):

`Network-segmentation-cheat-sheet`, `sre-checklist`, `karanpratapsingh/system-design`,
`system-design-notebook`, `full-stack-fastapi-template`, `system-design-101`,
`awesome-scalability`, `awesome-design-patterns`, `awesome-docker`, `awesome-compose`,
`system-design-primer`, `awesome-opentofu`, `awesome-cheatsheets`, `howtheydevops`,
`howtheysre`, `free-for-dev`, `awesome-sre`, `awesome-cursorrules`, `devops-resources`,
`awesome-privacy`, `awesome-prometheus`, `awesome-devsecops`, `awesome-sysadmin`,
`devops-exercises`, `projectlearn-project-based-learning`, `test-your-sysadmin-skills`,
`DevOps-Roadmap`, `infraverse`.

Duplicates **within the user's own list** (fold to one):

- `aixploria.com/en/` — listed twice
- `HeartMuLa/heartlib/tree/main` — listed three times
- `Xtremilicious/projectlearn-project-based-learning` vs
  `Xtremilicious/ProjectLearn-Project-Based-Learning` — GitHub is case-insensitive, same repo
- `projectlearn.io` vs `projectlearn.io/#categories` — same page

### 5.2 URL hygiene — do NOT store as-is

| URL | problem | action |
|-----|---------|--------|
| `dashboard.ngrok.com/login?state=<token>` | contains a login/session token | store `https://ngrok.com` |
| `app.leonardo.ai/auth/login?callbackUrl=…&gclid=…` | ad-tracking + auth redirect | store `https://leonardo.ai` |
| `certdirectory.io/profile/<uuid>` | personal profile id | drop or store site root |
| `cp.certmetrics.com`, `ci.freerdp.com` | personal portal / CI instance | drop (not a public resource) |
| `…?tab=readme-ov-file#…`, `#page-top`, `#0`, `#categories` | tracking/anchor cruft | normalize (strip hash + `utm_*`/`gclid`/`via`/`tab`) |

Never put personal data in a stored URL — same rule the app already follows
elsewhere.

### 5.3 New entries — bucket the rest of the user's URLs

**`catalog`** (cross-cutting AI directories, all `isDirectory: true`):
`aixploria.com/en`, `theresanaiforthat.com`, `aitoolsdirectory.com`,
`topai.tools`, `topai.tools/category/automation`,
`trendshift.io/github-trending-repositories`, `producthunt.com`,
`huggingface.co` (models/spaces index), plus curated adds: `openrouter.ai/models`,
`lmarena.ai` (LM Arena leaderboard), `artificialanalysis.ai`,
`llm-stats.com`, `github.com/e2b-dev/awesome-ai-agents`,
`github.com/Shubhamsaboo/awesome-llm-apps` (user has this),
`github.com/ashishpatel26/500-AI-Agents-Projects` (user),
`github.com/avinash201199/free-ai-agents-resources` (user).

**`mcpServer`**: `github.com/punkpeye/awesome-mcp-servers` (dir),
`registry.modelcontextprotocol.io` (dir), `mcpmarket.com` (dir),
`smithery.ai` (dir), `github.com/agentgateway/agentgateway`,
`skillsmp.com` / `skillsmp.com` (verify), plus adds:
`github.com/modelcontextprotocol/servers`, `mcp.so` (dir),
`glama.ai/mcp/servers` (dir), `github.com/wong2/awesome-mcp-servers`.

**`aiSkill`**: `agent-skills.md`, `skills.sh`, `skillsdirectory.com` (dir),
`skillsmp.com` (dir), `github.com/midudev/autoskills`,
`github.com/anthropics/skills` (add), `docs.claude.com` skills page (add).

**`aiFramework`**: `github.com/langgenius/dify`, `pydantic.dev` /
`github.com/pydantic/pydantic-ai`, `github.com/HKUDS/nanobot`,
`visionagents.ai`, `axolotl.ai` / `github.com/axolotl-ai-cloud/axolotl`,
`github.com/docling-project/docling` + `docling.ai`,
`github.com/google-labs-code/design.md` + `designmd.ai`,
`agent-foundry.pages.dev`, `codespeak.dev`, plus adds:
`github.com/google/adk-python` (Google Agent Dev Kit), `langchain.com`,
`github.com/openai/openai-agents-python`, `crewai.com`, `github.com/microsoft/autogen`,
`llamaindex.ai`, `github.com/BerriAI/litellm`, `github.com/vllm-project/vllm`.

**`aiApp`**: `huggingface.co/chat`, `github.com/bytedance/UI-TARS-desktop`,
`github.com/nanbingxyz/5ire`, `github.com/steipete/blucli`,
`github.com/Yakitrak/notesmd-cli`, `github.com/nutlope/hallmark`,
`github.com/VersusControl/ai-infrastructure-agent`, `github.com/stakpak/agent`,
`agent-zero.ai` / `github.com/agent0ai/agent-zero`, `openfang.sh`,
`github.com/openagen/zeroclaw`, `github.com/code-yeongyu/oh-my-openagent`,
`openlegion.ai`, `roomote.dev`, `ponyalphaai.com`, `hermesatlas.com`,
`celesto.ai`, `styles.refero.design`, `github.com/VoltAgent/awesome-design-md` (dir),
`github.com/google-labs-code/design.md`;
audio/media: `github.com/ace-step/ACE-Step-1.5`, `github.com/ASLP-lab/DiffRhythm`,
`github.com/MusicLang/musiclang`, `github.com/HeartMuLa/heartlib`,
`github.com/benjiyaya/HeartMuLa_ComfyUI`;
finance (tool links only, not advice): `github.com/HKUDS/AI-Trader`,
`github.com/hsliuping/TradingAgents-CN`, `github.com/ValueCell-ai/ClawX`,
`github.com/FujiwaraChoki/MoneyPrinterV2`, `github.com/yikart/AiToEarn`;
research: `github.com/uditgoenka/autoresearch`, `github.com/666ghj/MiroFish`,
`github.com/raphaelmansuy/edgequake`, `github.com/danicat/tenkai`,
`github.com/pinchtab/pinchtab`, `github.com/tashfeenahmed/freellmapi`
(verify — may be dead), `github.com/HKUDS/nanobot`.

**`automation`**: `topai.tools/category/automation` (dir),
`github.com/nutlope/hallmark`, plus adds: `n8n.io` / `github.com/n8n-io/n8n`,
`github.com/activepieces/activepieces`, `windmill.dev`,
`github.com/PipedreamHQ/pipedream`, `huginn`, `github.com/Kestra-io/kestra`.

**`aiModel`** (§6).

**Infra / DevOps — not AI** (route to existing types, add `hosting` /
`security` / `learning` tags):
- `curatedList`: `github.com/bregman-arie/devops-exercises` (dup — skip),
  `landscape.cncf.io` (dir), `github.com/binhnguyennus/...` (dup)
- `roadmap` / `exercise`: `projectlearn.io`, `codelabs.developers.google.com/...`,
  `mlu-explain.github.io`, `poloclub.github.io`, `github.com/skills/secure-code-game`,
  `github.com/kelseyhightower/kubernetes-the-hard-way`, `lpi.org/our-certifications`,
  `github.com/AdarshanaB/AWS-AI-Practitioner`
- hosting/tunnels/PaaS → **`type: 'devService'`**, new `/tools/dev-services`
  screen: `netlify.com`, `ngrok.com` (bare — strip the login token URL),
  `localtonet.com`, `github.com/shuttle-hq/shuttle` + `shuttle.dev`,
  `cloud.deploystack.io` → `deploystack.io`, `caddyserver.com`,
  `roomote.dev`, `codespeak.dev`. Curated adds: Cloudflare Tunnel, Tailscale
  Funnel, Vercel, Render, Railway, Fly.io, `bore.pub`, `pinggy.io`,
  `tunnelmole`, `frp`. Tags: `hosting`, `tunnel`, `paas`, `deploy`, `free-tier`.
- security/ops products (`wazuh.com`, `zaproxy.org`, `caddyserver.com`,
  `qubes-os.org`) → `documentation` tagged `security`
- misc dev (`jsonconsole.com`, `llmstxt.org`, `codespeak.dev`) → best-fit type
- unclear / needs manual review (`github.com/ai-engineering-at`,
  `github.com/christianhuth`, `github.com/openagen/zeroclaw`,
  `danicat.dev/posts/...`, `docs.cloud.google.com/...`,
  `www.appsheet.com/templates`, `codelabs...survivor-network`,
  `www.sysops.host/`, `www.youtube.com/watch?v=...`) — script marks, human decides.

### 5.4 Volume

Target **~120–150 new entries**. Deliver in review-sized batches (~30 per PR),
each PR = one `type` group + its screen.

---

## 6. Top-10 models + harnesses (`type: 'aiModel'`)

Model line-up shifts fast — **verify names/versions at implementation time**
(`artificialanalysis.ai`, `lmarena.ai`). As of this plan:

| Model family | Vendor | Link | Tools / harness |
|---|---|---|---|
| GPT-5.x | OpenAI | platform.openai.com/docs | Responses API, Agents SDK, Codex |
| Claude (Opus/Sonnet) | Anthropic | docs.claude.com | Claude Code, Agent SDK, MCP |
| Gemini 2.x/3 | Google | ai.google.dev | Gemini CLI, ADK, Vertex |
| Llama 4 | Meta | llama.com | llama-stack, torchtune |
| Qwen3 | Alibaba | github.com/QwenLM/Qwen3 | Qwen-Agent, DashScope |
| DeepSeek V3 / R1 | DeepSeek | github.com/deepseek-ai | vLLM/SGLang recipes |
| Mistral Large | Mistral | docs.mistral.ai | mistral-inference, La Plateforme |
| Grok 4 | xAI | docs.x.ai | xAI API |
| Kimi K2 | Moonshot | platform.moonshot.ai | — |
| GLM-4.6 | Zhipu | github.com/THUDM/GLM-4 | — |

Cross-model harness/serving (own entries, tag `harness`): Ollama, vLLM,
llama.cpp, LM Studio, Jan, SGLang, OpenRouter, LiteLLM, text-generation-webui,
Groq / Together / Fireworks (hosted inference).

Each model entry: `type: 'aiModel'`, tags `[<vendor>, 'llm', <'open-weights'|'proprietary'>]`.

---

## 7. Link-health + dedupe script

**`app/scripts/check-resource-links.ts`** — bun runs TS directly and imports
the data file as-is, no deps, no Python. Run: `bun run check:links`.
**Done (phase B).**

Does:

1. **Import** `EXTERNAL_RESOURCE_LINKS` from the built/transpiled data
   (`bunx tsx` or a tiny `tsc` step; or parse via `ts` — simplest is
   `bunx tsx scripts/check-resource-links.ts`).
2. **Normalize** each URL: lowercase host, strip `www.`, drop trailing `/`,
   strip `#…`, strip `utm_*` / `gclid` / `fbclid` / `via` / `ref` /
   `?tab=readme-ov-file`, lowercase GitHub `owner/repo`.
3. **Duplicate report**: normalized-URL collisions, exact `name` collisions,
   GitHub same-repo-different-path collisions → **exit 1**.
4. **Liveness**: `fetch(url, { method: 'HEAD', redirect: 'follow', signal:
   AbortSignal.timeout(10_000) })`; on 405/403/HEAD-unsupported retry `GET`
   with a browser `User-Agent`. Alive = final status `200`, or `301/302/308`
   to a live target, or `403`/`429` (bot-blocked but exists — warn, don't
   fail). Dead = `404`/`410`/`5xx`/DNS/timeout → **exit 1**, listed.
5. **Concurrency** 8, ~2 min budget for ~300 links.
6. Output: table (`OK` / `WARN` / `DEAD` / `DUPE`), summary counts, non-zero
   exit on DEAD or DUPE.
7. `--json` flag for CI; `--fix-normalize` prints a normalized copy of the
   array for manual paste (never auto-writes).

**CI**: `.github/workflows/links.yml` — run on PRs that touch
`cheatsheetContent.ts` (fast, blocking on DUPE only — external sites flap, so
DEAD is `continue-on-error` on PRs) + a weekly `schedule:` cron that opens an
issue on DEAD.

**Vitest** (`cheatsheetContent.test.ts`, runs in normal test suite — no
network): add
- normalized-URL uniqueness
- every new `ResourceType` has ≥1 entry
- `RESOURCE_TYPES` contains every `type` used in the data (and vice-versa)
- `isDirectory` entries exist for ai-catalogs to be non-empty
- bump the "≥34 entries" assertion

---

## 8. GitHub starred-repos importer (one-off, not in build)

**`app/scripts/import-github-stars.mjs`** — requires the user to be
`gh auth login`'d (no token handling in the script; MCP GitHub server needs
OAuth which isn't available in this session).

```
gh api --paginate user/starred \
  --jq '.[] | {name:.full_name,url:.html_url,desc:.description,topics:.topics,stars:.stargazers_count}'
```

Filter: `topics` or `description` matches
`/\b(ai|llm|agent|agents|mcp|rag|genai|prompt|skill)\b/i`. Emit candidate
`ReferenceLink` objects (`type` guessed from topics: `mcp`→`mcpServer`,
`agent`→`aiApp`, `framework|sdk`→`aiFramework`, else `aiApp`;
`awesome-*`/`*-list` → `isDirectory: true`) to
`scripts/out/github-stars-candidates.json` for **human review before paste**.
Never auto-append to the data file.

---

## 9. Phasing

| Phase | Scope | Commit | State |
|---|---|---|---|
| **A** | Data-model: new `ResourceType`s + `isDirectory`, `RESOURCE_TYPES`, `TYPE_LABELS`, tests | `57b2bc5` | done |
| **B** | `check-resource-links.ts` + `check:links` + Vitest additions + `links.yml` CI | `7a1bf83` | done |
| **C** | 8 screens + routes + `'AI & Automation'` group + `'Reference'` group | `a5e86d4` | done |
| **D1** | Seed `catalog` (15) + `mcpServer` (10) | `230eaae` | done |
| **D2** | Seed `aiFramework` (23) + `aiApp` (30) + 1 catalog | `b655c60` | done |
| **D3** | Seed `aiSkill` (6) + `automation` (10) | `fe7e5c9` | done |
| **D4** | Seed `aiModel` families (11) + harnesses (10) | `b70a673` | done |
| **D5** | Seed `devService` (18) | `338153d` | done |
| **E** | `import-github-stars.ts` + run + fold 23 unambiguous repos | `5fd5d5d` | done |
| **F** | Route 14 leftover non-AI URLs into existing screens | `1fc409b` | done |
| **G** *(opt)* | `ResourceLinkListView` "Catalogs / Projects" band | — | not done (optional) |

Every phase verified: `bun run build` + `bun run test` green,
`grep -rl "from 'react" app/src/core` empty, `bun run check:links` 0 dead /
0 dupes, new screens rendered in-browser.

---

## 10. Remaining question

- **GitHub stars (phase E)** — confirm `gh auth status` is logged in on your
  machine. Not a blocker for phases A–D5; phase E just needs it before running
  `import-github-stars.mjs`. If `gh` isn't set up, provide a read-only
  `GITHUB_TOKEN` env var instead and the script uses that.

All §"Decisions" items above are locked. Coding starts at phase A after this
doc is committed.
