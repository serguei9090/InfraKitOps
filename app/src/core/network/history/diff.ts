/**
 * Run-over-run diffing for the History / Compare view. Dispatches on
 * `resultShape`; each strategy is described in NETWORK_MODULE_PLAN.md §2.3.
 * Pure logic — no React, no backend.
 */
import { diffLines, type Change } from 'diff'
import {
  isScalarSeriesResult,
  isSetResult,
  isTextResult,
  type ResultShape,
  type RunSummary,
  type ScalarSeriesResult,
  type SetItem,
  type StoredRun,
} from './envelope'

export interface SetDiff {
  kind: 'set'
  added: SetItem[]
  removed: SetItem[]
  unchanged: SetItem[]
  /** For ordered sets (traceroute hops): true if the count changed. */
  countChanged: boolean
}

export interface TextDiffLine {
  type: 'add' | 'remove' | 'context'
  text: string
}

export interface TextDiff {
  kind: 'text'
  lines: TextDiffLine[]
  addedCount: number
  removedCount: number
}

export interface ScalarStatDelta {
  stat: string
  a: number
  b: number
  delta: number
}

export interface ScalarSeriesDiff {
  kind: 'scalar_series'
  unit: string
  deltas: ScalarStatDelta[]
}

export interface UnsupportedDiff {
  kind: 'unsupported'
  shape: ResultShape
}

export type RunDiff = SetDiff | TextDiff | ScalarSeriesDiff | UnsupportedDiff

/** Diff run A (older) against run B (newer). Both must be the same tool + shape. */
export function diffRuns(a: StoredRun, b: StoredRun): RunDiff {
  if (a.resultShape !== b.resultShape) return { kind: 'unsupported', shape: b.resultShape }

  switch (b.resultShape) {
    case 'set':
      if (isSetResult(a.result) && isSetResult(b.result)) {
        return diffSets(a.result.items, b.result.items)
      }
      break
    case 'text':
      if (isTextResult(a.result) && isTextResult(b.result)) {
        return diffText(a.result.text, b.result.text)
      }
      break
    case 'scalar_series':
      if (isScalarSeriesResult(a.result) && isScalarSeriesResult(b.result)) {
        return diffScalarSeries(a.result, b.result)
      }
      break
    case 'table':
      return { kind: 'unsupported', shape: 'table' }
  }
  return { kind: 'unsupported', shape: b.resultShape }
}

export function diffSets(a: SetItem[], b: SetItem[]): SetDiff {
  const aKeys = new Map(a.map((i) => [i.key, i]))
  const bKeys = new Map(b.map((i) => [i.key, i]))
  const added: SetItem[] = []
  const removed: SetItem[] = []
  const unchanged: SetItem[] = []
  for (const item of b) {
    if (aKeys.has(item.key)) unchanged.push(item)
    else added.push(item)
  }
  for (const item of a) {
    if (!bKeys.has(item.key)) removed.push(item)
  }
  return { kind: 'set', added, removed, unchanged, countChanged: a.length !== b.length }
}

const VOLATILE_LINE = /^(\s*(>>>|%|;;)|.*\b(Last update|Query time|WHEN|when)\b)/i

export function diffText(a: string, b: string, options: { normalizeVolatile?: boolean } = {}): TextDiff {
  const strip = (t: string) =>
    options.normalizeVolatile === false
      ? t
      : t
          .split('\n')
          .filter((l) => !VOLATILE_LINE.test(l))
          .join('\n')

  const parts: Change[] = diffLines(strip(a), strip(b))
  const lines: TextDiffLine[] = []
  let addedCount = 0
  let removedCount = 0
  for (const part of parts) {
    const type: TextDiffLine['type'] = part.added ? 'add' : part.removed ? 'remove' : 'context'
    for (const raw of part.value.split('\n')) {
      if (raw === '' && part.value.endsWith('\n')) continue
      lines.push({ type, text: raw })
      if (type === 'add') addedCount++
      if (type === 'remove') removedCount++
    }
  }
  return { kind: 'text', lines, addedCount, removedCount }
}

export function diffScalarSeries(a: ScalarSeriesResult, b: ScalarSeriesResult): ScalarSeriesDiff {
  const stats: (keyof ScalarSeriesResult['stats'])[] = ['min', 'avg', 'p50', 'p95', 'max', 'loss']
  const deltas: ScalarStatDelta[] = []
  for (const stat of stats) {
    const av = a.stats[stat]
    const bv = b.stats[stat]
    if (typeof av !== 'number' || typeof bv !== 'number') continue
    deltas.push({ stat, a: av, b: bv, delta: round(bv - av) })
  }
  return { kind: 'scalar_series', unit: b.unit || a.unit, deltas }
}

/**
 * A metric's value across every run to a target, oldest-first — feeds the
 * "latency to this host over time" sparkline. Reads `summary[metric]`.
 */
export function seriesOverTime(runs: RunSummary[], metric: string): { at: number; value: number }[] {
  return runs
    .filter((r) => typeof r.summary?.[metric] === 'number')
    .map((r) => ({ at: r.startedAt, value: r.summary![metric] as number }))
    .sort((x, y) => x.at - y.at)
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
