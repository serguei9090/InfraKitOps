/**
 * Structured result shapes returned by each backend tool inside a
 * `RunEnvelope.result`. Kept here (framework-free) so screens and the history
 * renderers share one definition. Each mirrors the Go tool package.
 */

export interface SntpServerRow {
  server: string
  ip?: string
  ok: boolean
  error?: string
  clockOffsetSec: number
  rttMs: number
  stratum: number
  referenceId?: string
  queriedAt: string
  serverTime?: string
}

export interface SntpResult {
  v: number
  servers: SntpServerRow[]
  medianOffsetSec: number
  okCount: number
}
