/**
 * The result envelope every Network Toolkit tool emits and the history layer
 * stores. Mirrors `internal/envelope/envelope.go` and the sidecar's
 * `/api/v1/history` shapes. See NETWORK_MODULE_PLAN.md §2.3.
 */

export type ResultShape = 'scalar_series' | 'set' | 'table' | 'text'

export type RunStatus = 'ok' | 'partial' | 'error' | 'timeout'

export interface RunEnvelope {
  tool: string
  target: string
  startedAt: number
  finishedAt?: number
  status: RunStatus
  /** Canonicalized (sorted keys) by `canonicalizeParams` so "same query" groups. */
  params: Record<string, unknown>
  resultShape: ResultShape
  /** Tool-specific, self-versioned: always carries `{ v: number, ... }`. */
  result: unknown
  /** Headline metrics for the history list row. */
  summary?: Record<string, unknown>
}

/** Lightweight row from `GET /api/v1/history`. */
export interface RunSummary {
  id: number
  tool: string
  target: string
  startedAt: number
  finishedAt?: number
  status: RunStatus
  resultShape: ResultShape
  summary?: Record<string, unknown>
  pinned: boolean
  label?: string
}

/** Full stored run from `GET /api/v1/history/{id}`. */
export interface StoredRun extends RunSummary {
  params: Record<string, unknown>
  result: unknown
}

/** Rebuild a display envelope from a stored history run (for "restore"). */
export function runToEnvelope(run: StoredRun): RunEnvelope {
  return {
    tool: run.tool,
    target: run.target,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    params: run.params,
    resultShape: run.resultShape,
    result: run.result,
    summary: run.summary,
  }
}

// --- Shape contracts ---------------------------------------------------------
// Tools whose resultShape is 'set' or 'scalar_series' put their result in one
// of these shapes so the generic diff below works without per-tool code.

export interface SetItem {
  /** Stable identity for diffing (e.g. "80/tcp", "10.0.0.4", hop index). */
  key: string
  /** Human label for the row. */
  label: string
  /** Optional secondary text shown under the label. */
  detail?: string
}

export interface SetResult {
  v: number
  items: SetItem[]
}

export interface ScalarSeriesResult {
  v: number
  unit: string
  samples: number[]
  stats: {
    min: number
    avg: number
    p50: number
    p95: number
    max: number
    /** 0..1 loss fraction, if meaningful for the tool. */
    loss?: number
  }
}

export interface TextResult {
  v: number
  text: string
}

export function isSetResult(x: unknown): x is SetResult {
  return typeof x === 'object' && x !== null && Array.isArray((x as SetResult).items)
}

export function isScalarSeriesResult(x: unknown): x is ScalarSeriesResult {
  return (
    typeof x === 'object' &&
    x !== null &&
    Array.isArray((x as ScalarSeriesResult).samples) &&
    typeof (x as ScalarSeriesResult).stats === 'object'
  )
}

export function isTextResult(x: unknown): x is TextResult {
  return typeof x === 'object' && x !== null && typeof (x as TextResult).text === 'string'
}
