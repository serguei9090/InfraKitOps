import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Cache Sizer — pure math, no I/O, no React.
 *
 * How much memory a cache needs for a target hit ratio, and what that hit
 * ratio buys in offloaded database load.
 *
 * Access-pattern model:
 *  - **uniform** — every key equally likely. Caching fraction `f` of the
 *    working set gives hit ratio ≈ `f`. Caching pays off slowly.
 *  - **skewed / very skewed** — Zipfian, exponent s ≈ 0.8 / 1.2. The head of
 *    the distribution carries most requests, so a small cache gets a high
 *    hit ratio. Hit ratio of caching the top `k` of `N` keys ≈
 *    `H(k, s) / H(N, s)` where `H` is the generalised harmonic number,
 *    approximated in closed form here.
 *
 *   full working set  = items · (valueBytes + keyOverheadBytes)
 *   memory for target = (entries needed for the target hit ratio) · entryBytes
 *   maxmemory         = that × 1.2   (fragmentation + housekeeping headroom)
 *
 * A planning estimate — real hit ratios depend on temporal locality, TTLs,
 * and how the working set shifts. Measure with `INFO stats` / `keyspace_hits`.
 */

export type AccessPattern = 'uniform' | 'skewed' | 'verySkewed'

export const ACCESS_PATTERN_LABELS: Record<AccessPattern, string> = {
  uniform: 'Uniform — all keys equally hot',
  skewed: 'Skewed (Zipf s≈0.8) — a hot head',
  verySkewed: 'Very skewed (Zipf s≈1.2) — a few keys dominate',
}

const ZIPF_S: Record<AccessPattern, number> = { uniform: 0, skewed: 0.8, verySkewed: 1.2 }

export type EvictionPolicy = 'allkeys-lru' | 'allkeys-lfu' | 'volatile-lru' | 'volatile-ttl' | 'noeviction'

/** Generalised harmonic H(n, s) = Σ_{i=1..n} i^-s, closed-form approximation. */
export function harmonic(n: number, s: number): number {
  if (n <= 0) return 0
  if (n < 1) n = 1
  if (Math.abs(s - 1) < 1e-9) return Math.log(n) + 0.5772156649015329 + 1 / (2 * n)
  return (n ** (1 - s) - 1) / (1 - s) + 1
}

/** Hit ratio for caching the hottest `fraction` of `totalItems` under Zipf exponent `s`. */
export function zipfHitRatio(fraction: number, totalItems: number, s: number): number {
  const f = Math.min(1, Math.max(0, fraction))
  if (s <= 0) return f
  const k = Math.max(1, Math.round(f * totalItems))
  return Math.min(1, harmonic(k, s) / harmonic(totalItems, s))
}

/** Fraction of items to cache to reach `targetRatio` under Zipf exponent `s`. */
export function fractionForHitRatio(targetRatio: number, totalItems: number, s: number): number {
  if (s <= 0) return Math.min(1, targetRatio)
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (zipfHitRatio(mid, totalItems, s) < targetRatio) lo = mid
    else hi = mid
  }
  return hi
}

export interface CacheSizerInput {
  /** Distinct keys in the working set. */
  workingSetItems: number
  /** Average serialized value size, bytes. */
  avgItemSizeBytes: number
  /** Per-entry overhead (key string, dict entry, expiry). Redis ≈ 64. Default 64. */
  keyOverheadBytes?: number
  /** Desired hit ratio, percent (0, 100). */
  targetHitRatioPercent: number
  accessPattern: AccessPattern
  /** Reads per second hitting the cache, for the DB-offload figure. */
  readsPerSec: number
  /** Latency a miss adds (DB round trip), milliseconds. For the time-saved figure. Default 5. */
  missLatencyMs?: number
  evictionPolicy?: EvictionPolicy
}

export interface CacheSizerResult {
  entryBytes: number
  fullWorkingSetBytes: number
  /** Fraction of items that must be resident for the target hit ratio. */
  fractionCached: number
  entriesForTarget: number
  memoryForTargetBytes: number
  /** Recommended `maxmemory` with headroom. */
  recommendedMaxmemoryBytes: number
  /** Hit ratio actually reached at `recommendedMaxmemory`. */
  achievedHitRatio: number
  /** Cache reads/sec served without touching the DB. */
  dbReadsOffloadedPerSec: number
  /** Cache reads/sec that still fall through to the DB. */
  dbReadsRemainingPerSec: number
  /** Aggregate DB latency avoided per second, in ms (readsOffloaded × missLatency). */
  latencyAvoidedMsPerSec: number
  configText: string
}

export class CacheSizer implements IToolUseCase<CacheSizerInput, CacheSizerResult> {
  execute(input: CacheSizerInput): CacheSizerResult {
    const keyOverhead = input.keyOverheadBytes ?? 64
    const missLatencyMs = input.missLatencyMs ?? 5
    const policy = input.evictionPolicy ?? 'allkeys-lru'
    const s = ZIPF_S[input.accessPattern]
    const target = input.targetHitRatioPercent / 100

    if (!Number.isInteger(input.workingSetItems) || input.workingSetItems < 1)
      throw new Error('workingSetItems must be an integer ≥ 1')
    if (input.avgItemSizeBytes <= 0) throw new Error('avgItemSizeBytes must be positive')
    if (keyOverhead < 0) throw new Error('keyOverheadBytes must be ≥ 0')
    if (target <= 0 || target >= 1) throw new Error('targetHitRatioPercent must be in (0, 100)')
    if (input.readsPerSec < 0) throw new Error('readsPerSec must be ≥ 0')

    const entryBytes = input.avgItemSizeBytes + keyOverhead
    const fullWorkingSetBytes = input.workingSetItems * entryBytes

    const fractionCached = fractionForHitRatio(target, input.workingSetItems, s)
    const entriesForTarget = Math.min(input.workingSetItems, Math.ceil(fractionCached * input.workingSetItems))
    const memoryForTargetBytes = entriesForTarget * entryBytes
    const recommendedMaxmemoryBytes = Math.ceil(memoryForTargetBytes * 1.2)

    const residentEntries = Math.min(
      input.workingSetItems,
      Math.floor(recommendedMaxmemoryBytes / 1.2 / entryBytes),
    )
    const achievedHitRatio = zipfHitRatio(residentEntries / input.workingSetItems, input.workingSetItems, s)

    const dbReadsOffloadedPerSec = input.readsPerSec * achievedHitRatio
    const dbReadsRemainingPerSec = input.readsPerSec * (1 - achievedHitRatio)
    const latencyAvoidedMsPerSec = dbReadsOffloadedPerSec * missLatencyMs

    return {
      entryBytes,
      fullWorkingSetBytes,
      fractionCached,
      entriesForTarget,
      memoryForTargetBytes,
      recommendedMaxmemoryBytes,
      achievedHitRatio,
      dbReadsOffloadedPerSec,
      dbReadsRemainingPerSec,
      latencyAvoidedMsPerSec,
      configText: renderRedis(recommendedMaxmemoryBytes, policy),
    }
  }
}

function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GiB`
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MiB`
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KiB`
  return `${b} B`
}

function renderRedis(maxmemoryBytes: number, policy: EvictionPolicy): string {
  return [
    '# redis.conf — generated by InfraKit Studio. Planning estimate; verify with INFO stats.',
    `maxmemory ${fmtBytes(maxmemoryBytes).replace(' ', '').toLowerCase()}`,
    `maxmemory-policy ${policy}`,
    '# lfu tracks frequency (better for a skewed head); lru tracks recency.',
    'maxmemory-samples 10',
    '# activedefrag yes   # if fragmentation ratio (INFO memory) stays above ~1.5',
  ].join('\n')
}
