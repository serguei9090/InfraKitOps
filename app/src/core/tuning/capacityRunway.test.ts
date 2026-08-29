import { describe, expect, it } from 'vitest'
import { CapacityRunway, type CapacityRunwayInput } from './capacityRunway'

const calc = new CapacityRunway()

const linearBase: CapacityRunwayInput = {
  currentUsage: 400,
  ceiling: 1000,
  growthModel: 'linear',
  growthRate: 50, // 50 units / month
  orderLeadTimeMonths: 2,
  targetHeadroomPercent: 20,
}

describe('CapacityRunway — linear', () => {
  it('months to ceiling: (1000 − 400) / 50 = 12', () => {
    expect(calc.execute(linearBase).monthsToCeiling).toBeCloseTo(12, 6)
  })

  it('trigger at 20% headroom = 800: (800 − 400) / 50 = 8', () => {
    expect(calc.execute(linearBase).monthsToTrigger).toBeCloseTo(8, 6)
  })

  it('order-by = min(trigger, ceiling − lead) = min(8, 10) = 8', () => {
    expect(calc.execute(linearBase).orderByMonth).toBeCloseTo(8, 6)
  })

  it('current headroom = 60%', () => {
    expect(calc.execute(linearBase).currentHeadroomPercent).toBeCloseTo(60, 6)
  })

  it('flat growth → never hits the ceiling', () => {
    const r = calc.execute({ ...linearBase, growthRate: 0 })
    expect(r.monthsToCeiling).toBe(Infinity)
    expect(r.actNow).toBe(false)
  })

  it('already over the trigger → actNow', () => {
    const r = calc.execute({ ...linearBase, currentUsage: 850 })
    expect(r.monthsToTrigger).toBe(0)
    expect(r.actNow).toBe(true)
  })
})

describe('CapacityRunway — compound', () => {
  const c: CapacityRunwayInput = {
    currentUsage: 100,
    ceiling: 800,
    growthModel: 'compound',
    growthRate: 10, // 10% / month
    targetHeadroomPercent: 25,
  }

  it('months to ceiling: log(8) / log(1.1) ≈ 21.8', () => {
    expect(calc.execute(c).monthsToCeiling).toBeCloseTo(Math.log(8) / Math.log(1.1), 6)
  })

  it('faster growth → shorter runway', () => {
    const slow = calc.execute({ ...c, growthRate: 5 })
    const fast = calc.execute({ ...c, growthRate: 20 })
    expect(fast.monthsToCeiling).toBeLessThan(slow.monthsToCeiling)
  })

  it('rejects growthRate ≤ −100%', () => {
    expect(() => calc.execute({ ...c, growthRate: -100 })).toThrow()
  })
})

describe('CapacityRunway — projection & validation', () => {
  it('projection includes month 0 and the horizon, headroom decreasing for growth', () => {
    const r = calc.execute({ ...linearBase, projectionMonths: 18 })
    expect(r.projection[0].month).toBe(0)
    expect(r.projection[r.projection.length - 1].month).toBe(18)
    expect(r.projection[0].headroomPercent).toBeGreaterThan(
      r.projection[r.projection.length - 1].headroomPercent,
    )
  })

  it('flags points past the ceiling', () => {
    const r = calc.execute({ ...linearBase, projectionMonths: 24 })
    expect(r.projection.some((p) => p.overCeiling)).toBe(true)
  })

  it('summary names the growth model and the order-by verdict', () => {
    expect(calc.execute(linearBase).summaryText).toMatch(/linear/)
    expect(calc.execute({ ...linearBase, currentUsage: 900 }).summaryText).toMatch(/ACT NOW/)
  })

  it('rejects bad inputs', () => {
    expect(() => calc.execute({ ...linearBase, ceiling: 0 })).toThrow()
    expect(() => calc.execute({ ...linearBase, currentUsage: -1 })).toThrow()
    expect(() => calc.execute({ ...linearBase, targetHeadroomPercent: 100 })).toThrow()
    expect(() => calc.execute({ ...linearBase, projectionMonths: 0 })).toThrow()
  })
})
