import { describe, expect, it } from 'vitest'
import {
  AvailabilityCalculator,
  kOfNAvailability,
  nines,
  type AvailabilityCalculatorInput,
} from './availabilityCalculator'

const calc = new AvailabilityCalculator()

describe('kOfNAvailability', () => {
  it('1-of-1 = A', () => {
    expect(kOfNAvailability(0.99, 1, 1)).toBeCloseTo(0.99, 12)
  })
  it('1-of-2 (either) = 1 − (1−A)^2', () => {
    expect(kOfNAvailability(0.9, 2, 1)).toBeCloseTo(1 - 0.1 * 0.1, 12) // 0.99
  })
  it('2-of-2 (both) = A^2', () => {
    expect(kOfNAvailability(0.9, 2, 2)).toBeCloseTo(0.81, 12)
  })
  it('2-of-3 (N+1) improves on a single instance', () => {
    expect(kOfNAvailability(0.99, 3, 2)).toBeGreaterThan(0.99)
  })
})

describe('nines', () => {
  it('99% → 2, 99.9% → 3, 99.99% → 4', () => {
    expect(nines(0.99)).toBeCloseTo(2, 6)
    expect(nines(0.999)).toBeCloseTo(3, 6)
    expect(nines(0.9999)).toBeCloseTo(4, 6)
  })
})

describe('AvailabilityCalculator', () => {
  it('series multiplies: three 99.9% tiers → 99.7%', () => {
    const input: AvailabilityCalculatorInput = {
      topology: 'series',
      components: [
        { name: 'lb', availabilityPercent: 99.9 },
        { name: 'app', availabilityPercent: 99.9 },
        { name: 'db', availabilityPercent: 99.9 },
      ],
    }
    const r = calc.execute(input)
    expect(r.systemAvailabilityPercent).toBeCloseTo(99.9 ** 3 / 100 ** 2, 6) // 99.7003
  })

  it('parallel: two 99% components → 99.99%', () => {
    const r = calc.execute({
      topology: 'parallel',
      components: [
        { name: 'a', availabilityPercent: 99 },
        { name: 'b', availabilityPercent: 99 },
      ],
    })
    expect(r.systemAvailabilityPercent).toBeCloseTo(99.99, 6)
  })

  it('MTBF/MTTR → availability: 1000h / 4h ≈ 99.602%', () => {
    const r = calc.execute({
      topology: 'series',
      components: [{ name: 'x', mtbfHours: 1000, mttrHours: 4 }],
    })
    expect(r.components[0].instanceAvailability).toBeCloseTo(1000 / 1004, 9)
  })

  it('redundancy lifts a component and reports "one more"', () => {
    const r = calc.execute({
      topology: 'series',
      components: [{ name: 'web', availabilityPercent: 99, redundancy: { total: 3, required: 2 } }],
    })
    const web = r.components[0]
    expect(web.effectiveAvailability).toBeGreaterThan(0.99)
    expect(web.availabilityWithOneMore).toBeGreaterThan(web.effectiveAvailability)
  })

  it('downtime per year: 99.9% ≈ 525.6 min', () => {
    const r = calc.execute({ topology: 'series', components: [{ name: 'x', availabilityPercent: 99.9 }] })
    expect(r.downtimePerYearMinutes).toBeCloseTo(0.001 * 365.25 * 24 * 60, 3)
  })

  it('target gap: system 99.7% vs target 99.9% → misses, positive gap', () => {
    const r = calc.execute({
      topology: 'series',
      targetPercent: 99.9,
      components: [
        { name: 'a', availabilityPercent: 99.9 },
        { name: 'b', availabilityPercent: 99.9 },
        { name: 'c', availabilityPercent: 99.9 },
      ],
    })
    expect(r.meetsTarget).toBe(false)
    expect(r.gapToTargetMinutesPerYear).toBeGreaterThan(0)
  })

  it('summary text names each component and its effective availability', () => {
    const r = calc.execute({
      topology: 'series',
      components: [{ name: 'db', availabilityPercent: 99.95, redundancy: { total: 2, required: 1 } }],
    })
    expect(r.summaryText).toContain('db [1-of-2]')
    expect(r.summaryText).toMatch(/effective/)
  })

  it('rejects bad inputs', () => {
    expect(() => calc.execute({ topology: 'series', components: [] })).toThrow()
    expect(() => calc.execute({ topology: 'series', components: [{ name: 'x' }] })).toThrow(/availability/i)
    expect(() =>
      calc.execute({ topology: 'series', components: [{ name: 'x', availabilityPercent: 150 }] }),
    ).toThrow()
    expect(() =>
      calc.execute({
        topology: 'series',
        components: [{ name: 'x', availabilityPercent: 99, redundancy: { total: 2, required: 3 } }],
      }),
    ).toThrow()
  })
})
