import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * An instant paired with an explicit UTC/local flag.
 *
 * The Dart reference relies on `DateTime.isUtc`, which a plain JS `Date`
 * has no equivalent for (a JS `Date` is always just an absolute timestamp —
 * there is no "this was constructed as UTC vs local" tag). `CrontabInstant`
 * carries that flag explicitly so the day-matching/next-run math can choose
 * UTC or local calendar fields exactly like the Dart port does. Build one
 * with `utcInstant(...)` / `localInstant(...)`, or `nowLocalInstant()` for
 * "now" in the caller's local zone (the default when `from` is omitted).
 */
export interface CrontabInstant {
  date: Date
  isUtc: boolean
}

export function utcInstant(year: number, month: number, day: number, hour = 0, minute = 0): CrontabInstant {
  return { date: new Date(Date.UTC(year, month - 1, day, hour, minute)), isUtc: true }
}

export function localInstant(year: number, month: number, day: number, hour = 0, minute = 0): CrontabInstant {
  return { date: new Date(year, month - 1, day, hour, minute), isUtc: false }
}

export function nowLocalInstant(): CrontabInstant {
  return { date: new Date(), isUtc: false }
}

function iYear(i: CrontabInstant): number {
  return i.isUtc ? i.date.getUTCFullYear() : i.date.getFullYear()
}
function iMonth(i: CrontabInstant): number {
  return (i.isUtc ? i.date.getUTCMonth() : i.date.getMonth()) + 1
}
function iDay(i: CrontabInstant): number {
  return i.isUtc ? i.date.getUTCDate() : i.date.getDate()
}
function iHour(i: CrontabInstant): number {
  return i.isUtc ? i.date.getUTCHours() : i.date.getHours()
}
function iMinute(i: CrontabInstant): number {
  return i.isUtc ? i.date.getUTCMinutes() : i.date.getMinutes()
}
/** 0 = Sunday .. 6 = Saturday — JS's own `getDay()`/`getUTCDay()` numbering already matches cron's. */
function iWeekday(i: CrontabInstant): number {
  return i.isUtc ? i.date.getUTCDay() : i.date.getDay()
}

/**
 * Builds an instant in the same zone as `reference`. Out-of-range
 * components (month 13, day 32, hour 24, minute 60) normalise via the
 * native `Date` constructor's own rollover, exactly the behaviour the
 * search loop below relies on.
 */
function at(reference: CrontabInstant, year: number, month: number, day: number, hour: number, minute: number): CrontabInstant {
  const date = reference.isUtc ? new Date(Date.UTC(year, month - 1, day, hour, minute)) : new Date(year, month - 1, day, hour, minute)
  return { date, isUtc: reference.isUtc }
}

/** Which of the five crontab columns a value belongs to. */
type CronField = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek'

/**
 * How a single crontab column should be generated in "build" mode.
 *
 * Deliberately a small closed set (rather than free text) so the UI can offer
 * a dropdown per column and still guarantee a syntactically valid field.
 */
export type CronFieldSpecKind = 'every' | 'list' | 'range' | 'step' | 'rangeStep'

/** A declarative description of one crontab column, used by `CrontabBuilder.build` to emit the corresponding field text. */
export interface CronFieldSpec {
  kind: CronFieldSpecKind
  values?: number[]
  start?: number
  end?: number
  step?: number
}

/** `*` — every legal value for the column. */
export function cronEvery(): CronFieldSpec {
  return { kind: 'every' }
}
/** `a,b,c` — an explicit list. Duplicates are collapsed, order is normalised by sorting. */
export function cronValues(values: number[]): CronFieldSpec {
  return { kind: 'list', values }
}
/** `a-b` — an inclusive range. */
export function cronRange(start: number, end: number): CronFieldSpec {
  return { kind: 'range', start, end }
}
/** `star/n` (e.g. `*``/6`) — every n-th value across the whole column. */
export function cronStep(step: number): CronFieldSpec {
  return { kind: 'step', step }
}
/** `a-b/n` — every n-th value inside an inclusive range. */
export function cronRangeStep(start: number, end: number, step: number): CronFieldSpec {
  return { kind: 'rangeStep', start, end, step }
}

/** Structured input for building an expression from scratch. */
export interface CrontabBuildInput {
  minute?: CronFieldSpec
  hour?: CronFieldSpec
  dayOfMonth?: CronFieldSpec
  month?: CronFieldSpec
  dayOfWeek?: CronFieldSpec
  /** Reference instant for `CrontabResult.nextRuns`. Defaults to "now" (local) when omitted. */
  from?: CrontabInstant
  nextRunCount?: number
}

/** Everything the UI needs to render for one schedule. */
export interface CrontabResult {
  /** The five-field expression (or the `@shortcut` when one was supplied). */
  expression: string
  /** Plain-English rendering, e.g. "At 09:00 on Monday through Friday". */
  description: string
  /** Upcoming matching instants. Always empty for `@reboot`, which has no wall-clock schedule at all. */
  nextRuns: CrontabInstant[]
  isReboot: boolean
}

/** One parsed `a-b/n` term inside a crontab column. */
interface Term {
  start: number
  end: number
  step: number
  /** True when this term was written with `*` (as opposed to an explicit range). */
  star: boolean
}

/** One fully parsed crontab column: the literal terms (kept for describing) plus the expanded set of matching values. */
export interface CronColumn {
  /** The original field text, e.g. `1-5` or `star/15`. */
  text: string
  /** Every value this column matches, already normalised (day-of-week 7 is folded onto 0). */
  values: Set<number>
  /** True when the field began with `*`. */
  isStar: boolean
  /** @internal parsed terms, used by the describe logic. Not part of the stable public shape. */
  terms: Term[]
}

/** A parsed crontab expression, ready for matching and describing. */
export interface CronSchedule {
  /** The normalised five-field expression. For a `@shortcut` input this is the expansion, except `@reboot`. */
  expression: string
  minute: CronColumn
  hour: CronColumn
  dayOfMonth: CronColumn
  month: CronColumn
  dayOfWeek: CronColumn
  isReboot: boolean
}

/**
 * Implements the classic cron day-matching rule:
 *
 * * if day-of-month **or** day-of-week is `*`, both columns must match (AND);
 * * if **neither** is `*`, a day matches when **either** column matches (OR).
 *
 * The OR branch is the gotcha most naive implementations get wrong:
 * `0 0 13 * 5` fires on every Friday *and* on the 13th, not only on
 * Friday the 13th.
 */
function matchesDate(schedule: CronSchedule, instant: CrontabInstant): boolean {
  if (!schedule.month.values.has(iMonth(instant))) return false

  const dom = iDay(instant)
  const dow = iWeekday(instant)

  const domMatch = schedule.dayOfMonth.values.has(dom)
  const dowMatch = schedule.dayOfWeek.values.has(dow)

  if (schedule.dayOfMonth.isStar || schedule.dayOfWeek.isStar) return domMatch && dowMatch
  return domMatch || dowMatch
}

// --------------------------------------------------------------- metadata --

interface FieldMeta {
  label: string
  singular: string
  plural: string
  min: number
  max: number
  /** Accepted textual aliases (uppercase) mapped to their numeric value. */
  names: Record<string, number>
  /** Full names used when describing, indexed from `min`. */
  displayNames: string[]
  nameExample: string
}

function displayValue(meta: FieldMeta, value: number): string {
  if (meta.displayNames.length === 0) return `${value}`
  const index = value - meta.min
  if (index < 0 || index >= meta.displayNames.length) return `${value}`
  return meta.displayNames[index]
}

const monthNames: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
}
const dayNames: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }

const metas: Record<CronField, FieldMeta> = {
  minute: { label: 'minute', singular: 'minute', plural: 'minutes', min: 0, max: 59, names: {}, displayNames: [], nameExample: '' },
  hour: { label: 'hour', singular: 'hour', plural: 'hours', min: 0, max: 23, names: {}, displayNames: [], nameExample: '' },
  dayOfMonth: {
    label: 'day-of-month',
    singular: 'day-of-month',
    plural: 'days-of-month',
    min: 1,
    max: 31,
    names: {},
    displayNames: [],
    nameExample: '',
  },
  month: {
    label: 'month',
    singular: 'month',
    plural: 'months',
    min: 1,
    max: 12,
    names: monthNames,
    nameExample: 'JAN',
    displayNames: [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ],
  },
  dayOfWeek: {
    label: 'day-of-week',
    singular: 'day-of-week',
    plural: 'days-of-week',
    // 7 is the second legal spelling of Sunday.
    min: 0,
    max: 7,
    names: dayNames,
    nameExample: 'MON',
    displayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  },
}

function metaOf(field: CronField): FieldMeta {
  return metas[field]
}

function tryParseInt(text: string): number | null {
  if (!/^[+-]?\d+$/.test(text)) return null
  const n = Number.parseInt(text, 10)
  return Number.isNaN(n) ? null : n
}

/** Renders `spec` as crontab field text, validating it against `field`'s legal range. Throws on an out-of-range or internally inconsistent spec. */
function renderCronFieldSpec(spec: CronFieldSpec, field: CronField): string {
  const meta = metaOf(field)

  function check(value: number, what: string): void {
    if (!Number.isInteger(value)) {
      throw new Error(`${what} ${value} must be a whole number for ${meta.label}`)
    }
    if (value < meta.min || value > meta.max) {
      throw new Error(`${what} ${value} is out of range for ${meta.label} (allowed ${meta.min}-${meta.max})`)
    }
  }

  function checkStep(n: number): void {
    if (!Number.isInteger(n) || n < 1 || n > meta.max) {
      throw new Error(`Step ${n} must be a whole number between 1 and ${meta.max} for ${meta.label}`)
    }
  }

  switch (spec.kind) {
    case 'every':
      return '*'

    case 'list': {
      const values = spec.values ?? []
      if (values.length === 0) {
        throw new Error(`At least one value is required for ${meta.label}`)
      }
      for (const v of values) check(v, 'Value')
      const sorted = [...new Set(values)].sort((a, b) => a - b)
      return sorted.join(',')
    }

    case 'range': {
      const s = spec.start!
      const e = spec.end!
      check(s, 'Range start')
      check(e, 'Range end')
      if (s > e) {
        throw new Error(`Range start ${s} must not be greater than range end ${e} for ${meta.label}`)
      }
      return s === e ? `${s}` : `${s}-${e}`
    }

    case 'step': {
      const n = spec.step!
      checkStep(n)
      return n === 1 ? '*' : `*/${n}`
    }

    case 'rangeStep': {
      const s = spec.start!
      const e = spec.end!
      const n = spec.step!
      check(s, 'Range start')
      check(e, 'Range end')
      if (s > e) {
        throw new Error(`Range start ${s} must not be greater than range end ${e} for ${meta.label}`)
      }
      checkStep(n)
      return n === 1 ? `${s}-${e}` : `${s}-${e}/${n}`
    }
  }
}

function isFullStar(column: CronColumn): boolean {
  return column.terms.length === 1 && column.terms[0].star && column.terms[0].step === 1
}

/** Returns the sorted single values when every term is a plain single value, otherwise null. */
function singlesOf(terms: Term[]): number[] | null {
  const out: number[] = []
  for (const t of terms) {
    if (t.star || t.start !== t.end) return null
    out.push(t.start)
  }
  out.sort((a, b) => a - b)
  return out
}

function describeTerm(term: Term, meta: FieldMeta): string {
  if (term.star) {
    return term.step === 1 ? `every ${meta.singular}` : `every ${term.step} ${meta.plural}`
  }
  if (term.start === term.end) return displayValue(meta, term.start)
  if (term.step === 1) {
    return `${displayValue(meta, term.start)} through ${displayValue(meta, term.end)}`
  }
  return `every ${term.step} ${meta.plural} from ${displayValue(meta, term.start)} through ${displayValue(meta, term.end)}`
}

function joinAnd(parts: string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function pad2(value: number): string {
  return `${value}`.padStart(2, '0')
}

function normalise(value: number, field: CronField): number {
  if (field === 'dayOfWeek' && value === 7) return 0
  return value
}

/** Finds the `-` that separates a range, skipping a leading sign so that a malformed `-5` reports as a bad value rather than an empty range bound. */
function rangeSeparatorIndex(body: string): number {
  return body.indexOf('-', 1)
}

function nextRunsInternal(schedule: CronSchedule, from: CrontabInstant, count: number): CrontabInstant[] {
  if (count <= 0) return []

  const results: CrontabInstant[] = []
  // Truncate to minute precision, then step forward one minute: results are
  // strictly after `from`.
  let cursor = at(from, iYear(from), iMonth(from), iDay(from), iHour(from), iMinute(from) + 1)

  // Cron schedules can legitimately be years apart (`0 0 29 2 *`), but an
  // unsatisfiable one (`0 0 30 2 *`) must not spin forever.
  const horizon = iYear(from) + 8
  let guard = 0

  while (results.length < count && iYear(cursor) <= horizon && guard < 200000) {
    guard++

    if (!schedule.month.values.has(iMonth(cursor))) {
      cursor = at(cursor, iYear(cursor), iMonth(cursor) + 1, 1, 0, 0)
      continue
    }
    if (!matchesDate(schedule, cursor)) {
      cursor = at(cursor, iYear(cursor), iMonth(cursor), iDay(cursor) + 1, 0, 0)
      continue
    }
    if (!schedule.hour.values.has(iHour(cursor))) {
      cursor = at(cursor, iYear(cursor), iMonth(cursor), iDay(cursor), iHour(cursor) + 1, 0)
      continue
    }
    if (!schedule.minute.values.has(iMinute(cursor))) {
      cursor = at(cursor, iYear(cursor), iMonth(cursor), iDay(cursor), iHour(cursor), iMinute(cursor) + 1)
      continue
    }

    results.push(cursor)
    cursor = at(cursor, iYear(cursor), iMonth(cursor), iDay(cursor), iHour(cursor), iMinute(cursor) + 1)
  }

  return results
}

/**
 * Bidirectional crontab tool: build an expression from structured input,
 * explain an existing one in plain English, and compute upcoming run times.
 *
 * Pure TypeScript — no packages, no I/O, no React. All date math is done
 * with calendar components rather than raw timestamp arithmetic so a UTC
 * input stays UTC and a local input keeps its own wall-clock semantics —
 * see `CrontabInstant`.
 */
export class CrontabBuilder implements IToolUseCase<CrontabBuildInput, CrontabResult> {
  /** Nickname shortcuts understood by Vixie cron and its descendants. */
  static readonly shortcuts: Record<string, string> = {
    '@yearly': '0 0 1 1 *',
    '@annually': '0 0 1 1 *',
    '@monthly': '0 0 1 * *',
    '@weekly': '0 0 * * 0',
    '@daily': '0 0 * * *',
    '@midnight': '0 0 * * *',
    '@hourly': '0 * * * *',
  }

  execute(input: CrontabBuildInput): CrontabResult {
    const expression = this.build(input)
    const from = input.from ?? nowLocalInstant()
    return {
      expression,
      description: this.explain(expression),
      nextRuns: this.nextRunTimes(expression, from, input.nextRunCount ?? 5),
      isReboot: false,
    }
  }

  /** Same as `execute` but starting from an existing expression. */
  describe(expression: string, opts: { from?: CrontabInstant; nextRunCount?: number } = {}): CrontabResult {
    const schedule = this.parse(expression)
    const from = opts.from ?? nowLocalInstant()
    return {
      expression: schedule.isReboot ? '@reboot' : schedule.expression,
      description: this.describeSchedule(schedule),
      nextRuns: schedule.isReboot ? [] : nextRunsInternal(schedule, from, opts.nextRunCount ?? 5),
      isReboot: schedule.isReboot,
    }
  }

  // ---------------------------------------------------------------- build --

  /** Renders `input`'s five columns into a crontab expression. */
  build(input: CrontabBuildInput): string {
    return [
      renderCronFieldSpec(input.minute ?? cronEvery(), 'minute'),
      renderCronFieldSpec(input.hour ?? cronEvery(), 'hour'),
      renderCronFieldSpec(input.dayOfMonth ?? cronEvery(), 'dayOfMonth'),
      renderCronFieldSpec(input.month ?? cronEvery(), 'month'),
      renderCronFieldSpec(input.dayOfWeek ?? cronEvery(), 'dayOfWeek'),
    ].join(' ')
  }

  // ---------------------------------------------------------------- parse --

  /** Expands a `@shortcut` to its five-field equivalent, or returns null when `expression` is not a recognised shortcut. `@reboot` returns null too. */
  expandShortcut(expression: string): string | null {
    return CrontabBuilder.shortcuts[expression.trim().toLowerCase()] ?? null
  }

  /** Parses a crontab expression (five fields or a `@shortcut`). Throws with an explanatory message on anything that is not a valid expression. */
  parse(expression: string): CronSchedule {
    const raw = expression.trim()
    if (raw.length === 0) {
      throw new Error('Expression is empty')
    }

    if (raw.startsWith('@')) {
      const nickname = raw.toLowerCase()
      if (nickname === '@reboot') {
        return {
          expression: '@reboot',
          minute: this.parseColumn('*', 'minute'),
          hour: this.parseColumn('*', 'hour'),
          dayOfMonth: this.parseColumn('*', 'dayOfMonth'),
          month: this.parseColumn('*', 'month'),
          dayOfWeek: this.parseColumn('*', 'dayOfWeek'),
          isReboot: true,
        }
      }
      const expanded = CrontabBuilder.shortcuts[nickname]
      if (expanded == null) {
        throw new Error(
          `Unknown shortcut "${raw}". Supported: @reboot, @yearly, @annually, ` +
            '@monthly, @weekly, @daily, @midnight, @hourly',
        )
      }
      return this.parseFields(expanded)
    }

    return this.parseFields(raw)
  }

  private parseFields(raw: string): CronSchedule {
    const fields = raw.split(/\s+/).filter((f) => f.length > 0)
    if (fields.length !== 5) {
      throw new Error(
        `Expected 5 fields (minute hour day-of-month month day-of-week) but found ${fields.length} in "${raw}"`,
      )
    }

    return {
      expression: fields.join(' '),
      minute: this.parseColumn(fields[0], 'minute'),
      hour: this.parseColumn(fields[1], 'hour'),
      dayOfMonth: this.parseColumn(fields[2], 'dayOfMonth'),
      month: this.parseColumn(fields[3], 'month'),
      dayOfWeek: this.parseColumn(fields[4], 'dayOfWeek'),
      isReboot: false,
    }
  }

  private parseColumn(text: string, field: CronField): CronColumn {
    const meta = metaOf(field)
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      throw new Error(`The ${meta.label} field is empty`)
    }

    const terms: Term[] = []
    const values = new Set<number>()

    for (const piece of trimmed.split(',')) {
      const item = piece.trim()
      if (item.length === 0) {
        throw new Error(`Empty list item in the ${meta.label} field "${trimmed}"`)
      }

      let body = item
      let step = 1

      const slash = item.indexOf('/')
      if (slash >= 0) {
        body = item.substring(0, slash).trim()
        const stepText = item.substring(slash + 1).trim()
        if (body.length === 0) {
          throw new Error(`Missing value before "/" in the ${meta.label} field "${item}"`)
        }
        const parsedStep = tryParseInt(stepText)
        step = parsedStep == null ? -1 : parsedStep
        if (step < 1) {
          throw new Error(`Invalid step "${stepText}" in the ${meta.label} field "${item}" (must be 1 or more)`)
        }
        if (step > meta.max) {
          throw new Error(`Step ${step} is larger than the ${meta.label} range ${meta.min}-${meta.max}`)
        }
        if (item.substring(slash + 1).includes('/')) {
          throw new Error(`Multiple "/" separators in the ${meta.label} field "${item}"`)
        }
      }

      let start: number
      let end: number
      let star = false

      if (body === '*') {
        star = true
        start = meta.min
        end = meta.max
      } else {
        const dash = rangeSeparatorIndex(body)
        if (dash > 0) {
          start = this.parseValue(body.substring(0, dash), field, item)
          end = this.parseValue(body.substring(dash + 1), field, item)
          if (start > end) {
            throw new Error(`Range start ${start} is greater than range end ${end} in the ${meta.label} field "${item}"`)
          }
        } else {
          start = this.parseValue(body, field, item)
          // `5/10` is the widely-supported "from 5, every 10" extension.
          end = slash >= 0 ? meta.max : start
        }
      }

      terms.push({ start, end, step, star })
      for (let v = start; v <= end; v += step) {
        values.add(normalise(v, field))
      }
    }

    if (values.size === 0) {
      throw new Error(`The ${meta.label} field "${trimmed}" matches no values`)
    }

    return { text: trimmed, terms, values, isStar: trimmed.startsWith('*') }
  }

  private parseValue(text: string, field: CronField, context: string): number {
    const meta = metaOf(field)
    const token = text.trim()
    if (token.length === 0) {
      throw new Error(`Missing value in the ${meta.label} field "${context}"`)
    }

    const named = meta.names[token.toUpperCase()]
    const value = named ?? tryParseInt(token)
    if (value == null) {
      throw new Error(
        `Invalid value "${token}" in the ${meta.label} field` +
          `${Object.keys(meta.names).length === 0 ? '' : ` (expected a number or a name like ${meta.nameExample})`}`,
      )
    }
    if (value < meta.min || value > meta.max) {
      throw new Error(`Value ${value} is out of range for the ${meta.label} field (allowed ${meta.min}-${meta.max})`)
    }
    return value
  }

  // -------------------------------------------------------------- explain --

  /** Parses `expression` and returns a plain-English description. */
  explain(expression: string): string {
    return this.describeSchedule(this.parse(expression))
  }

  /** Plain-English rendering of an already-parsed schedule. */
  describeSchedule(schedule: CronSchedule): string {
    if (schedule.isReboot) {
      return 'At system startup (once, each time the machine boots)'
    }

    const segments: string[] = [this.describeTime(schedule)]

    if (!isFullStar(schedule.dayOfMonth)) {
      segments.push(`on day-of-month ${this.describeColumn(schedule.dayOfMonth, 'dayOfMonth')}`)
    }
    if (!isFullStar(schedule.month)) {
      segments.push(`in ${this.describeColumn(schedule.month, 'month')}`)
    }
    if (!isFullStar(schedule.dayOfWeek)) {
      segments.push(`on ${this.describeColumn(schedule.dayOfWeek, 'dayOfWeek')}`)
    }

    let text = segments.join(' ')

    if (!schedule.dayOfMonth.isStar && !schedule.dayOfWeek.isStar) {
      text += ' (day-of-month and day-of-week are both restricted, so cron fires when EITHER matches)'
    }

    return text
  }

  private describeTime(schedule: CronSchedule): string {
    const minuteTerms = schedule.minute.terms
    const hourTerms = schedule.hour.terms

    const minuteStar = isFullStar(schedule.minute)
    const hourStar = isFullStar(schedule.hour)
    const minuteStepOnly = minuteTerms.length === 1 && minuteTerms[0].star
    const hourStepOnly = hourTerms.length === 1 && hourTerms[0].star

    const minuteSingles = singlesOf(minuteTerms)
    const hourSingles = singlesOf(hourTerms)

    if (minuteStar && hourStar) return 'Every minute'
    if (hourStar && minuteStepOnly) return `Every ${minuteTerms[0].step} minutes`
    if (minuteStar && hourStepOnly) {
      return `Every minute of every ${hourTerms[0].step} hours`
    }

    if (hourStar && minuteSingles != null) {
      return `At minute ${joinAnd(minuteSingles.map((m) => `${m}`))} of every hour`
    }
    if (minuteStar && hourSingles != null) {
      return `Every minute of hour ${joinAnd(hourSingles.map((h) => `${h}`))}`
    }

    if (minuteSingles != null && hourSingles != null && minuteSingles.length * hourSingles.length <= 12) {
      const times: string[] = []
      for (const h of hourSingles) {
        for (const m of minuteSingles) {
          times.push(`${pad2(h)}:${pad2(m)}`)
        }
      }
      times.sort()
      return `At ${joinAnd(times)}`
    }

    return `At minute ${this.describeColumn(schedule.minute, 'minute')}, hour ${this.describeColumn(schedule.hour, 'hour')}`
  }

  private describeColumn(column: CronColumn, field: CronField): string {
    const meta = metaOf(field)
    return joinAnd(column.terms.map((t) => describeTerm(t, meta)))
  }

  // ------------------------------------------------------------ next runs --

  /**
   * Returns the next `count` instants strictly after `from` that match
   * `expression`. `@reboot` yields an empty list.
   *
   * The search advances by the coarsest field that fails (month, then day,
   * then hour, then minute), so even a sparse schedule such as
   * `0 0 29 2 *` resolves in a handful of iterations instead of stepping
   * through millions of minutes.
   */
  nextRunTimes(expression: string, from: CrontabInstant, count: number): CrontabInstant[] {
    const schedule = this.parse(expression)
    if (schedule.isReboot) return []
    return nextRunsInternal(schedule, from, count)
  }
}
