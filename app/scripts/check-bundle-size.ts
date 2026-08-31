/**
 * CS4 budget guard (CODE_SPLITTING_PLAN.md). Sums the gzipped size of the
 * JS the browser must fetch for the FIRST paint — the entry `<script>` plus
 * every `<link rel="modulepreload">` Vite emits into dist/index.html — and
 * fails if it exceeds BUDGET_GZIP_KB.
 *
 *   bun run check:bundle        # after `bun run build`
 *
 * Route chunks (lazy: in routes.tsx) are NOT counted — they load on demand.
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const BUDGET_GZIP_KB = 260

const dist = join(import.meta.dir, '..', 'dist')
const html = join(dist, 'index.html')

if (!existsSync(html)) {
  console.error('dist/index.html not found — run `bun run build` first')
  process.exit(2)
}

const doc = readFileSync(html, 'utf8')
const assets = new Set<string>()
for (const m of doc.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)) assets.add(m[1])

if (assets.size === 0) {
  console.error('no /assets/*.js referenced from index.html — build layout changed?')
  process.exit(2)
}

let totalGzip = 0
const rows: { name: string; raw: number; gz: number }[] = []
for (const a of assets) {
  const p = join(dist, 'assets', a)
  if (!existsSync(p)) continue
  const buf = readFileSync(p)
  const gz = gzipSync(buf).length
  totalGzip += gz
  rows.push({ name: a, raw: statSync(p).size, gz })
}

rows.sort((x, y) => y.gz - x.gz)
const kb = (n: number) => (n / 1024).toFixed(1).padStart(7)
for (const r of rows) console.log(`${kb(r.gz)} kB gz  ${kb(r.raw)} kB raw  ${r.name}`)

const totalKb = totalGzip / 1024
console.log('─'.repeat(48))
console.log(`${kb(totalGzip)} kB gz   first-load total   (budget ${BUDGET_GZIP_KB} kB)`)

if (totalKb > BUDGET_GZIP_KB) {
  console.error(`\n✗ first-load bundle ${totalKb.toFixed(1)} kB > ${BUDGET_GZIP_KB} kB budget`)
  console.error('  a heavy import leaked into the entry / shell path — lazy-load it or split it.')
  process.exit(1)
}
console.log('\n✓ within budget')
