import { describe, expect, it } from 'vitest'
import {
  CacheSizer,
  fractionForHitRatio,
  harmonic,
  zipfHitRatio,
  type CacheSizerInput,
} from './cacheSizer'

const sizer = new CacheSizer()

const base: CacheSizerInput = {
  workingSetItems: 1_000_000,
  avgItemSizeBytes: 512,
  keyOverheadBytes: 64,
  targetHitRatioPercent: 90,
  accessPattern: 'skewed',
  readsPerSec: 20_000,
  missLatencyMs: 5,
}

describe('harmonic / zipf helpers', () => {
  it('H(n, 1) ≈ ln(n) + γ', () => {
    expect(harmonic(1000, 1)).toBeCloseTo(Math.log(1000) + 0.5772156649, 2)
  })
  it('uniform (s=0): hit ratio = fraction cached', () => {
    expect(zipfHitRatio(0.3, 1000, 0)).toBeCloseTo(0.3, 10)
  })
  it('skewed: caching 10% gets much more than 10% hit ratio', () => {
    expect(zipfHitRatio(0.1, 1_000_000, 1)).toBeGreaterThan(0.6)
  })
  it('fractionForHitRatio inverts zipfHitRatio', () => {
    const f = fractionForHitRatio(0.9, 1_000_000, 1)
    expect(zipfHitRatio(f, 1_000_000, 1)).toBeCloseTo(0.9, 2)
  })
})

describe('CacheSizer', () => {
  it('entry bytes = value + overhead; full working set scales with items', () => {
    const r = sizer.execute(base)
    expect(r.entryBytes).toBe(512 + 64)
    expect(r.fullWorkingSetBytes).toBe(1_000_000 * 576)
  })

  it('skew reduces the memory a 90% hit ratio needs vs uniform', () => {
    const skewed = sizer.execute(base) // s ≈ 0.8
    const verySkewed = sizer.execute({ ...base, accessPattern: 'verySkewed' }) // s ≈ 1.2
    const uniform = sizer.execute({ ...base, accessPattern: 'uniform' })
    expect(skewed.fractionCached).toBeLessThan(uniform.fractionCached)
    expect(verySkewed.fractionCached).toBeLessThan(skewed.fractionCached)
    expect(verySkewed.fractionCached).toBeLessThan(0.3)
  })

  it('uniform pattern needs ~90% of the working set for a 90% hit ratio', () => {
    const r = sizer.execute({ ...base, accessPattern: 'uniform' })
    expect(r.fractionCached).toBeCloseTo(0.9, 2)
  })

  it('maxmemory carries ~20% headroom over the target memory', () => {
    const r = sizer.execute(base)
    expect(r.recommendedMaxmemoryBytes).toBeGreaterThanOrEqual(r.memoryForTargetBytes * 1.2 - 1)
  })

  it('achieved hit ratio is at least the target', () => {
    const r = sizer.execute(base)
    expect(r.achievedHitRatio).toBeGreaterThanOrEqual(0.9 - 0.02)
  })

  it('DB offload: reads/sec split by the hit ratio', () => {
    const r = sizer.execute(base)
    expect(r.dbReadsOffloadedPerSec + r.dbReadsRemainingPerSec).toBeCloseTo(20_000, 3)
    expect(r.dbReadsOffloadedPerSec).toBeCloseTo(20_000 * r.achievedHitRatio, 6)
    expect(r.latencyAvoidedMsPerSec).toBeCloseTo(r.dbReadsOffloadedPerSec * 5, 6)
  })

  it('generates a redis.conf with maxmemory + policy', () => {
    const r = sizer.execute({ ...base, evictionPolicy: 'allkeys-lfu' })
    expect(r.configText).toMatch(/maxmemory \d/)
    expect(r.configText).toContain('maxmemory-policy allkeys-lfu')
  })

  it('rejects bad inputs', () => {
    expect(() => sizer.execute({ ...base, workingSetItems: 0 })).toThrow()
    expect(() => sizer.execute({ ...base, avgItemSizeBytes: 0 })).toThrow()
    expect(() => sizer.execute({ ...base, targetHitRatioPercent: 100 })).toThrow()
    expect(() => sizer.execute({ ...base, readsPerSec: -1 })).toThrow()
  })
})
