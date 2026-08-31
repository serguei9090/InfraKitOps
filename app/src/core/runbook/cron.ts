/**
 * Runbooks — a small 5-field cron parser for the Schedules UI (R4b). It mirrors
 * `backend/internal/orchestrator/cron.go`: the backend is authoritative for
 * firing; this is used to validate the expression as the user types and to
 * preview the next few run times. Framework-free.
 *
 * Fields: minute hour day-of-month month day-of-week. Each accepts a wildcard,
 * a single value, ranges, step values, and comma lists. Day-of-week is 0-6
 * (Sun = 0; 7 also accepted). Macros: @hourly @daily @weekly @monthly @yearly.
 * Times are computed in the runtime's local zone, matching the Go backend.
 */

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

interface ParsedCron {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
  domRestricted: boolean
  dowRestricted: boolean
}

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>()
  for (const rawPart of field.split(',')) {
    const part = rawPart.trim()
    if (!part) throw new Error('empty term')
    let step = 1
    let range = part
    const slash = part.indexOf('/')
    if (slash >= 0) {
      range = part.slice(0, slash)
      step = Number(part.slice(slash + 1))
      if (!Number.isInteger(step) || step <= 0) throw new Error(`bad step "${part.slice(slash + 1)}"`)
    }
    let lo = min
    let hi = max
    if (range !== '*') {
      const dash = range.indexOf('-')
      if (dash >= 0) {
        lo = Number(range.slice(0, dash))
        hi = Number(range.slice(dash + 1))
      } else {
        lo = hi = Number(range)
      }
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error(`bad value "${range}"`)
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`out of range [${min}-${max}]: "${part}"`)
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

/** Parse a cron expression. Throws `Error` with a human message on bad input. */
export function parseCron(expr: string): ParsedCron {
  const raw = expr.trim()
  if (!raw) throw new Error('empty cron expression')
  const spec = MACROS[raw.toLowerCase()] ?? raw
  const f = spec.split(/\s+/)
  if (f.length !== 5) throw new Error(`cron needs 5 fields (got ${f.length})`)
  const dowNorm = f[4]
    .split(',')
    .map((p) => p.split('-').map((x) => (x.trim() === '7' ? '0' : x)).join('-'))
    .join(',')
  const wrap = (label: string, fn: () => Set<number>) => {
    try {
      return fn()
    } catch (e) {
      throw new Error(`${label}: ${e instanceof Error ? e.message : e}`)
    }
  }
  return {
    minute: wrap('minute', () => parseField(f[0], 0, 59)),
    hour: wrap('hour', () => parseField(f[1], 0, 23)),
    dom: wrap('day-of-month', () => parseField(f[2], 1, 31)),
    month: wrap('month', () => parseField(f[3], 1, 12)),
    dow: wrap('day-of-week', () => parseField(dowNorm, 0, 6)),
    domRestricted: f[2] !== '*',
    dowRestricted: f[4] !== '*',
  }
}

/** True if `expr` is a valid cron expression. */
export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr)
    return true
  } catch {
    return false
  }
}

function dayMatches(p: ParsedCron, d: Date): boolean {
  const dom = p.dom.has(d.getDate())
  const dow = p.dow.has(d.getDay())
  if (p.domRestricted && p.dowRestricted) return dom || dow
  if (p.domRestricted) return dom
  if (p.dowRestricted) return dow
  return true
}

/** The first time strictly after `after` that matches, or null if none within ~4y. */
export function cronNext(expr: string, after: Date = new Date()): Date | null {
  const p = parseCron(expr)
  const t = new Date(after.getTime())
  t.setSeconds(0, 0)
  t.setMinutes(t.getMinutes() + 1)
  const limit = new Date(after.getTime())
  limit.setFullYear(limit.getFullYear() + 4)
  while (t < limit) {
    if (!p.month.has(t.getMonth() + 1)) {
      t.setMonth(t.getMonth() + 1, 1)
      t.setHours(0, 0, 0, 0)
      continue
    }
    if (!dayMatches(p, t)) {
      t.setDate(t.getDate() + 1)
      t.setHours(0, 0, 0, 0)
      continue
    }
    if (!p.hour.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!p.minute.has(t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1, 0, 0)
      continue
    }
    return t
  }
  return null
}

/** The next `count` run times, for a preview. */
export function cronNextRuns(expr: string, count = 3, after: Date = new Date()): Date[] {
  const out: Date[] = []
  let cur = after
  for (let i = 0; i < count; i++) {
    const n = cronNext(expr, cur)
    if (!n) break
    out.push(n)
    cur = n
  }
  return out
}

const COMMON: Record<string, string> = {
  '@hourly': 'every hour',
  '@daily': 'every day at midnight',
  '@weekly': 'every Sunday at midnight',
  '@monthly': 'the 1st of every month',
  '@yearly': 'every January 1st',
  '* * * * *': 'every minute',
  '0 * * * *': 'every hour, on the hour',
  '0 0 * * *': 'every day at midnight',
  '0 9 * * 1-5': 'weekdays at 09:00',
  '*/5 * * * *': 'every 5 minutes',
  '*/15 * * * *': 'every 15 minutes',
  '*/30 * * * *': 'every 30 minutes',
}

/** A short human description — falls back to the raw expression. */
export function describeCron(expr: string): string {
  const raw = expr.trim().toLowerCase()
  if (COMMON[raw]) return COMMON[raw]
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(raw)
  if (m) return `every day at ${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`
  return expr.trim()
}
