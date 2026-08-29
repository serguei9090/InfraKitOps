import { describe, expect, it } from 'vitest'
import { CloudRightSize, type CloudRightSizeInput } from './cloudRightSize'

const calc = new CloudRightSize()

const base: CloudRightSizeInput = {
  currentVcpu: 16,
  currentRamGb: 64,
  observedCpuP95Percent: 25,
  observedRamP95Percent: 30,
  targetUtilizationPercent: 60,
  onDemandHourly: 0.8,
  hoursPerMonth: 730,
  instanceCount: 4,
  reservedDiscountPercent: 40,
  spotDiscountPercent: 70,
  spotFractionPercent: 0,
}

describe('CloudRightSize — right-sizing', () => {
  it('16 vCPU @ 25% p95, target 60% → needed 6.67 → next common size 8', () => {
    const r = calc.execute(base)
    expect(r.recommendedVcpu).toBe(8)
  })

  it('64 GiB @ 30% p95, target 60% → needed 32 → 32', () => {
    expect(calc.execute(base).recommendedRamGb).toBe(32)
  })

  it('RAM-bound when memory util is the higher pressure', () => {
    const r = calc.execute({ ...base, observedCpuP95Percent: 10, observedRamP95Percent: 55 })
    // cpu needed ~2.7 → 4 (ratio 0.25); ram needed ~58.7 → 64 (ratio 1.0)
    expect(r.bindingDimension).toBe('ram')
    expect(r.sizeRatio).toBeCloseTo(1, 6)
  })

  it('price scales with the binding ratio', () => {
    const r = calc.execute(base) // cpu ratio 8/16 = 0.5, ram ratio 32/64 = 0.5
    expect(r.rightSizedHourly).toBeCloseTo(0.8 * 0.5, 6)
  })
})

describe('CloudRightSize — commitment', () => {
  it('monthly costs order: current > right-sized OD > reserved', () => {
    const r = calc.execute(base)
    expect(r.monthlyCurrent).toBeGreaterThan(r.monthlyRightSizedOnDemand)
    expect(r.monthlyRightSizedOnDemand).toBeGreaterThan(r.monthlyRightSizedReserved)
  })

  it('savings are current − option', () => {
    const r = calc.execute(base)
    expect(r.savingVsCurrentReserved).toBeCloseTo(r.monthlyCurrent - r.monthlyRightSizedReserved, 6)
  })

  it('reserved break-even = (1 − discount): 40% discount → 60%', () => {
    expect(calc.execute(base).reservedBreakEvenUtilPercent).toBeCloseTo(60, 6)
  })

  it('spot mix: 50% spot @ 70% off + 50% reserved @ 40% off is cheaper than all-reserved', () => {
    const allReserved = calc.execute({ ...base, spotFractionPercent: 0 })
    const halfSpot = calc.execute({ ...base, spotFractionPercent: 50 })
    expect(halfSpot.monthlyRightSizedSpotMix).toBeLessThan(allReserved.monthlyRightSizedReserved)
  })

  it('100% spot mix ≈ pure spot price', () => {
    const r = calc.execute({ ...base, spotFractionPercent: 99.9 })
    const pureSpotMonthly = r.rightSizedHourly * 0.3 * 730 * 4
    expect(r.monthlyRightSizedSpotMix).toBeCloseTo(pureSpotMonthly, 0)
  })
})

describe('CloudRightSize — validation & summary', () => {
  it('summary names the recommended size and the break-even', () => {
    const r = calc.execute(base)
    expect(r.summaryText).toMatch(/Right-size to: 8 vCPU \/ 32 GiB/)
    expect(r.summaryText).toMatch(/> 60% of the time/)
  })

  it('rejects bad inputs', () => {
    expect(() => calc.execute({ ...base, currentVcpu: 0 })).toThrow()
    expect(() => calc.execute({ ...base, onDemandHourly: 0 })).toThrow()
    expect(() => calc.execute({ ...base, targetUtilizationPercent: 0 })).toThrow()
    expect(() => calc.execute({ ...base, reservedDiscountPercent: 100 })).toThrow()
    expect(() => calc.execute({ ...base, instanceCount: 0 })).toThrow()
  })
})
