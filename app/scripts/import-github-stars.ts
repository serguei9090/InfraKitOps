/**
 * One-off: pull the user's starred GitHub repos, keep the AI-ish ones, and
 * emit candidate ReferenceLink objects for MANUAL review before paste into
 * cheatsheetContent.ts. Never writes the data file.
 *
 *   gh auth login            # once, if not already
 *   bun run import:stars                       # uses gh
 *   GITHUB_TOKEN=ghp_... bun run import:stars  # or a read-only PAT, no gh
 *
 * Output: scripts/out/github-stars-candidates.json
 * See KNOWLEDGE_HUB_AI_EXPANSION_PLAN.md §8.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { EXTERNAL_RESOURCE_LINKS } from '../src/core/cheatsheets/cheatsheetContent'

const AI_RE = /\b(ai|a\.i|llm|llms|agent|agents|agentic|mcp|rag|genai|gen-ai|prompt|prompting|skill|skills|diffusion|inference|embeddings?|vector|chatbot|copilot|transformer|fine-?tun\w*)\b/i

interface Star {
  full_name: string
  html_url: string
  description: string | null
  topics: string[]
  stargazers_count: number
  archived: boolean
}

function fetchViaGh(): Star[] {
  const raw = execFileSync(
    'gh',
    ['api', '--paginate', 'user/starred', '--jq',
     '.[] | {full_name,html_url,description,topics,stargazers_count,archived}'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  // --jq streams one JSON object per line
  return raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Star)
}

async function fetchViaToken(token: string): Promise<Star[]> {
  const out: Star[] = []
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`https://api.github.com/user/starred?per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
    const batch = (await res.json()) as Star[]
    if (batch.length === 0) break
    out.push(...batch)
  }
  return out
}

function guessType(s: Star): { type: string; isDirectory?: boolean } {
  const hay = `${s.full_name} ${s.description ?? ''} ${s.topics.join(' ')}`.toLowerCase()
  const isDir = /awesome-|(^|\s)awesome($|\s)|\blist\b|\bcollection\b|\bcurated\b|\bdirectory\b|\bregistry\b/.test(hay)
  if (/\bmcp\b|model-context-protocol/.test(hay)) return { type: 'mcpServer', isDirectory: isDir || undefined }
  if (/\bskill\b|skills/.test(hay)) return { type: 'aiSkill', isDirectory: isDir || undefined }
  if (/framework|sdk|library|\btoolkit\b|orchestrat/.test(hay)) return { type: 'aiFramework' }
  if (/\bn8n\b|workflow|automation|zapier/.test(hay)) return { type: 'automation' }
  if (isDir) return { type: 'catalog', isDirectory: true }
  return { type: 'aiApp' }
}

async function main() {
  const token = process.env.GITHUB_TOKEN
  const stars = token ? await fetchViaToken(token) : fetchViaGh()

  const known = new Set(EXTERNAL_RESOURCE_LINKS.map((l) => l.url.toLowerCase().replace(/\/+$/, '')))
  const candidates = stars
    .filter((s) => !s.archived)
    .filter((s) => AI_RE.test(`${s.full_name} ${s.description ?? ''} ${s.topics.join(' ')}`))
    .filter((s) => !known.has(s.html_url.toLowerCase().replace(/\/+$/, '')))
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .map((s) => {
      const { type, isDirectory } = guessType(s)
      return {
        name: s.full_name.split('/')[1] ?? s.full_name,
        url: s.html_url,
        description: (s.description ?? '').slice(0, 140),
        type,
        tags: ['ai', ...s.topics.slice(0, 3)],
        ...(isDirectory ? { isDirectory: true } : {}),
        _stars: s.stargazers_count,
        _review: 'CHECK description + type before pasting',
      }
    })

  mkdirSync('scripts/out', { recursive: true })
  const path = 'scripts/out/github-stars-candidates.json'
  writeFileSync(path, JSON.stringify(candidates, null, 2))
  console.log(`${stars.length} stars scanned -> ${candidates.length} AI candidates not already in the data`)
  console.log(`wrote ${path} — review by hand, then paste the good ones into cheatsheetContent.ts`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
