import { describe, expect, it } from 'vitest'
import { EtcdSizer, type EtcdSizerInput } from './etcdSizer'

const sizer = new EtcdSizer()

const base: EtcdSizerInput = {
  objectCount: 100_000,
  avgObjectSizeBytes: 8192,
  writesPerSec: 50,
  compactionRetentionHours: 1,
  fragmentationFactor: 1.8,
  quotaBackendGiB: 8,
}

const GIB = 1024 ** 3

describe('EtcdSizer', () => {
  it('live data = objects · avgSize', () => {
    expect(sizer.execute(base).liveDataBytes).toBe(100_000 * 8192)
  })

  it('history = writes/s · compaction seconds · avgSize', () => {
    expect(sizer.execute(base).historyBytes).toBe(50 * 3600 * 8192)
  })

  it('peak DB size = (live + history) · fragmentation', () => {
    const r = sizer.execute(base)
    expect(r.peakDbSizeBytes).toBeCloseTo((r.liveDataBytes + r.historyBytes) * 1.8, 3)
  })

  it('quota + hard-limit utilisation are percentages of the respective ceilings', () => {
    const r = sizer.execute(base)
    expect(r.quotaUtilizationPercent).toBeCloseTo((r.peakDbSizeBytes / (8 * GIB)) * 100, 6)
    expect(r.hardLimitUtilizationPercent).toBeCloseTo((r.peakDbSizeBytes / (8 * GIB)) * 100, 6)
  })

  it('recommended RAM ≥ 8 GiB and ≥ 2.5× the DB', () => {
    const r = sizer.execute({ ...base, objectCount: 2_000_000 })
    expect(r.recommendedRamBytes).toBeGreaterThanOrEqual(8 * GIB)
    expect(r.recommendedRamBytes).toBeGreaterThanOrEqual(r.peakDbSizeBytes * 2.5 - 1)
  })

  it('write IOPS ≈ writes/s; bandwidth ≈ writes/s · size · 2 (WAL + DB)', () => {
    const r = sizer.execute(base)
    expect(r.writeIops).toBe(50)
    expect(r.writeBandwidthBytesPerSec).toBe(50 * 8192 * 2)
  })

  it('warns when peak DB size blows the 8 GiB wall', () => {
    const r = sizer.execute({ ...base, objectCount: 700_000, writesPerSec: 200, compactionRetentionHours: 4 })
    expect(r.peakDbSizeBytes).toBeGreaterThan(8 * GIB)
    expect(r.warnings.join(' ')).toMatch(/8 GiB hard limit/i)
  })

  it('warns when history dwarfs live data', () => {
    const r = sizer.execute({ ...base, objectCount: 1000, writesPerSec: 500, compactionRetentionHours: 5 })
    expect(r.warnings.join(' ')).toMatch(/history.*more than 2×/i)
  })

  it('no writes → infinite defrag interval, no defrag warning', () => {
    const r = sizer.execute({ ...base, writesPerSec: 0 })
    expect(r.defragIntervalHours).toBe(Infinity)
    expect(r.warnings.join(' ')).not.toMatch(/defrag threshold/i)
  })

  it('generates etcd flags with the quota and compaction retention', () => {
    const r = sizer.execute({ ...base, quotaBackendGiB: 6, compactionRetentionHours: 0.5 })
    expect(r.configText).toContain(`--quota-backend-bytes=${Math.round(6 * GIB)}`)
    expect(r.configText).toContain('--auto-compaction-retention=30m')
  })

  it('rejects bad inputs', () => {
    expect(() => sizer.execute({ ...base, objectCount: 0 })).toThrow()
    expect(() => sizer.execute({ ...base, writesPerSec: -1 })).toThrow()
    expect(() => sizer.execute({ ...base, compactionRetentionHours: 0 })).toThrow()
    expect(() => sizer.execute({ ...base, fragmentationFactor: 0.5 })).toThrow()
  })
})
