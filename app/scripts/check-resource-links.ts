/**
 * Link-health + dedupe check for EXTERNAL_RESOURCE_LINKS.
 *
 *   bun run check:links            # human table, exits 1 on DEAD or DUPE
 *   bun run check:links -- --json  # machine-readable, for CI
 *   bun run check:links -- --no-net # dedupe/normalize only, skip HTTP
 *
 * Run with bun (executes TS directly, imports the data file as-is). No deps.
 * See KNOWLEDGE_HUB_AI_EXPANSION_PLAN.md §7.
 */
import { EXTERNAL_RESOURCE_LINKS, type ReferenceLink } from '../src/core/cheatsheets/cheatsheetContent'

const args = new Set(process.argv.slice(2))
const JSON_OUT = args.has('--json')
const NO_NET = args.has('--no-net')
const CONCURRENCY = 8
const TIMEOUT_MS = 10_000
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const STRIP_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'via', 'ref']

/** Canonical form for dedupe: host without www, no trailing slash, no hash, no tracking params, lowercased github/gitlab repo path. */
function normalize(raw: string): string {
  const u = new URL(raw)
  u.hash = ''
  for (const p of STRIP_PARAMS) u.searchParams.delete(p)
  if (u.searchParams.get('tab') === 'readme-ov-file') u.searchParams.delete('tab')
  const host = u.hostname.replace(/^www\./, '').toLowerCase()
  let path = u.pathname.replace(/\/+$/, '')
  if (host === 'github.com' || host === 'gitlab.com') path = path.toLowerCase()
  const search = u.searchParams.toString()
  return `${host}${path}${search ? `?${search}` : ''}`
}

type Verdict = 'OK' | 'WARN' | 'DEAD'
interface Row {
  name: string
  url: string
  verdict: Verdict
  detail: string
}

async function probe(url: string): Promise<Row> {
  const name = EXTERNAL_RESOURCE_LINKS.find((l) => l.url === url)?.name ?? url
  const attempt = async (method: 'HEAD' | 'GET'): Promise<Response> =>
    fetch(url, {
      method,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: '*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  try {
    let res = await attempt('HEAD')
    if (res.status === 405 || res.status === 501 || res.status === 403) res = await attempt('GET')
    const s = res.status
    if (s >= 200 && s < 300) return { name, url, verdict: 'OK', detail: String(s) }
    if (s === 403 || s === 429 || s === 401)
      return { name, url, verdict: 'WARN', detail: `${s} (bot-blocked but reachable)` }
    return { name, url, verdict: 'DEAD', detail: String(s) }
  } catch (err) {
    return { name, url, verdict: 'DEAD', detail: (err as Error).name || String(err) }
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return out
}

function groupBy(links: ReferenceLink[], key: (l: ReferenceLink) => string, val: (l: ReferenceLink) => string) {
  const m = new Map<string, string[]>()
  for (const l of links) {
    const k = key(l)
    const arr = m.get(k) ?? []
    arr.push(val(l))
    m.set(k, arr)
  }
  return [...m.values()].filter((v) => v.length > 1)
}

function findDupes(links: ReferenceLink[]) {
  return {
    urlDupes: groupBy(links, (l) => normalize(l.url), (l) => l.url),
    nameDupes: groupBy(links, (l) => l.name.trim().toLowerCase(), (l) => l.name),
  }
}

async function main() {
  const links = EXTERNAL_RESOURCE_LINKS
  const { urlDupes, nameDupes } = findDupes(links)

  let rows: Row[] = []
  if (!NO_NET) {
    rows = await mapPool(links.map((l) => l.url), CONCURRENCY, probe)
  }

  const dead = rows.filter((r) => r.verdict === 'DEAD')
  const warn = rows.filter((r) => r.verdict === 'WARN')
  const hasDupes = urlDupes.length > 0 || nameDupes.length > 0

  if (JSON_OUT) {
    console.log(JSON.stringify({ total: links.length, dead, warn, urlDupes, nameDupes }, null, 2))
  } else {
    console.log(`\n  ${links.length} resource links\n`)
    if (hasDupes) {
      console.log('  DUPLICATES')
      for (const g of urlDupes) console.log(`    url:  ${g.join('  ==  ')}`)
      for (const g of nameDupes) console.log(`    name: ${g.join('  ==  ')}`)
      console.log('')
    }
    if (!NO_NET) {
      for (const r of [...dead, ...warn]) {
        console.log(`    ${r.verdict.padEnd(4)}  ${r.detail.padEnd(28)}  ${r.name}  ->  ${r.url}`)
      }
      console.log(
        `\n  ${rows.length - dead.length - warn.length} OK   ${warn.length} WARN   ${dead.length} DEAD\n`,
      )
    }
  }

  if (dead.length > 0 || hasDupes) process.exit(1)
}

main()
