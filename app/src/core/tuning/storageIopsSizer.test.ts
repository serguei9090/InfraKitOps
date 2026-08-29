import { describe, expect, it } from 'vitest'
import { StorageIopsSizer, writePenalty, type StorageIopsSizerInput } from './storageIopsSizer'

const sizer = new StorageIopsSizer()

const base: StorageIopsSizerInput = {
  targetIops: 10_000,
  readPercent: 70,
  perDiskIops: 800,
  perDiskCapacityGb: 1000,
  requiredCapacityGb: 4000,
  layout: 'raid10',
  growthPercentPerYear: 30,
}

describe('writePenalty', () => {
  it('0/1/10/5/6 penalties', () => {
    expect(writePenalty('raid0', 3)).toBe(1)
    expect(writePenalty('raid1', 3)).toBe(2)
    expect(writePenalty('raid10', 3)).toBe(2)
    expect(writePenalty('raid5', 3)).toBe(4)
    expect(writePenalty('raid6', 3)).toBe(6)
    expect(writePenalty('replication', 3)).toBe(3)
  })
})

describe('StorageIopsSizer', () => {
  it('back-end IOPS = reads + writes × penalty (RAID 10, 70% read)', () => {
    const r = sizer.execute(base)
    // reads 7000, writes 3000 × 2 = 6000 → 13000
    expect(r.frontEndReadIops).toBe(7000)
    expect(r.frontEndWriteIops).toBe(3000)
    expect(r.backEndIops).toBe(13_000)
    expect(r.disksForIops).toBe(Math.ceil(13_000 / 800)) // 17
  })

  it('RAID 5 write penalty of 4 needs far more disks for a write-heavy load', () => {
    const r5 = sizer.execute({ ...base, layout: 'raid5', readPercent: 30 })
    // writes 7000 × 4 = 28000 + reads 3000 = 31000 back-end
    expect(r5.backEndIops).toBe(31_000)
    expect(r5.penalty).toBe(4)
  })

  it('capacity disks: RAID 10 needs 2× the data disks', () => {
    const r = sizer.execute({ ...base, targetIops: 10, perDiskIops: 100_000 }) // IOPS trivial
    // need 4000 GiB / 1000 = 4 data disks → 8 for RAID 10
    expect(r.disksForCapacity).toBe(8)
    expect(r.disksNeeded).toBe(8)
  })

  it('RAID 5 capacity: data disks + 1 parity', () => {
    const r = sizer.execute({ ...base, layout: 'raid5', targetIops: 10, perDiskIops: 100_000 })
    expect(r.disksForCapacity).toBe(4 + 1)
  })

  it('disks needed covers IOPS, capacity and layout minimum, rounded even for RAID 10', () => {
    const r = sizer.execute(base)
    expect(r.disksNeeded).toBeGreaterThanOrEqual(
      Math.max(r.disksForIops, r.disksForCapacity, r.layoutMinimumDisks),
    )
    expect(r.disksNeeded % 2).toBe(0) // RAID 10 even
  })

  it('replication ×3: usable = raw / 3', () => {
    const r = sizer.execute({ ...base, layout: 'replication', replicationFactor: 3, targetIops: 10, perDiskIops: 100_000 })
    expect(r.penalty).toBe(3)
    expect(r.usableCapacityFraction).toBeCloseTo(1 / 3, 6)
    // need 4000 usable → 12000 raw → 12 disks
    expect(r.disksForCapacity).toBe(12)
  })

  it('usable write IOPS = disks × per-disk / penalty', () => {
    const r = sizer.execute(base)
    expect(r.usableIops).toBeCloseTo((r.disksNeeded * 800) / 2, 6)
  })

  it('growth runway shrinks as growth rate rises', () => {
    const slow = sizer.execute({ ...base, growthPercentPerYear: 10 })
    const fast = sizer.execute({ ...base, growthPercentPerYear: 100 })
    expect(fast.runwayYears).toBeLessThan(slow.runwayYears)
  })

  it('runway is Infinity with no growth', () => {
    expect(sizer.execute({ ...base, growthPercentPerYear: 0 }).runwayYears).toBe(Infinity)
  })

  it('summary text mentions the penalty and the disk count', () => {
    const r = sizer.execute(base)
    expect(r.summaryText).toMatch(/write penalty ×2/)
    expect(r.summaryText).toMatch(/Disks needed:\s+\d+/)
  })

  it('rejects bad inputs', () => {
    expect(() => sizer.execute({ ...base, targetIops: 0 })).toThrow()
    expect(() => sizer.execute({ ...base, readPercent: 120 })).toThrow()
    expect(() => sizer.execute({ ...base, perDiskIops: -1 })).toThrow()
    expect(() => sizer.execute({ ...base, requiredCapacityGb: 0 })).toThrow()
  })
})
