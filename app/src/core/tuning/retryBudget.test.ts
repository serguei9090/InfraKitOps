import { describe, expect, it } from 'vitest'
import { RetryBudget, type RetryBudgetInput } from './retryBudget'

const calc = new RetryBudget()

const base: RetryBudgetInput = {
  endToEndBudgetMs: 1000,
  hops: [
    { name: 'gateway', typicalMs: 20, timeoutMs: 900, retries: 0, backoffBaseMs: 0 },
    { name: 'service-a', typicalMs: 60, timeoutMs: 400, retries: 1, backoffBaseMs: 50 },
    { name: 'database', typicalMs: 30, timeoutMs: 100, retries: 2, backoffBaseMs: 20 },
  ],
}

describe('RetryBudget', () => {
  it('hop worst case = retries·timeout + success + Σ backoff', () => {
    const r = calc.execute(base)
    // database: 2·100 + min(30,100) + 20·(2^2−1) = 200 + 30 + 60 = 290
    const db = r.hops.find((h) => h.name === 'database')!
    expect(db.attempts).toBe(3)
    expect(db.totalBackoffMs).toBe(60)
    expect(db.worstCaseMs).toBe(290)
  })

  it('total worst case is the sum of hops', () => {
    const r = calc.execute(base)
    expect(r.worstCaseTotalMs).toBeCloseTo(r.hops.reduce((a, h) => a + h.worstCaseMs, 0), 6)
  })

  it('retry amplification = Π (1 + retries)', () => {
    const r = calc.execute(base)
    expect(r.retryAmplification).toBe((1 + 0) * (1 + 1) * (1 + 2)) // 6
    expect(r.amplificationRisk).toBe(true) // > 4
  })

  it('no-retry chain has amplification 1 and no risk', () => {
    const r = calc.execute({
      ...base,
      hops: base.hops.map((h) => ({ ...h, retries: 0 })),
    })
    expect(r.retryAmplification).toBe(1)
    expect(r.amplificationRisk).toBe(false)
  })

  it('flags a chain that blows the budget', () => {
    const r = calc.execute({ ...base, endToEndBudgetMs: 300 })
    expect(r.fitsBudget).toBe(false)
    expect(r.warnings.join(' ')).toMatch(/exceeds the 300 ms budget/)
  })

  it('flags a parent timeout shorter than downstream worst case', () => {
    const r = calc.execute({
      endToEndBudgetMs: 5000,
      hops: [
        { name: 'a', typicalMs: 10, timeoutMs: 100, retries: 0, backoffBaseMs: 0 }, // 100 < b+c worst
        { name: 'b', typicalMs: 50, timeoutMs: 500, retries: 1, backoffBaseMs: 0 },
        { name: 'c', typicalMs: 50, timeoutMs: 500, retries: 1, backoffBaseMs: 0 },
      ],
    })
    const a = r.hops[0]
    expect(a.timeoutTooTightForDownstream).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/not larger than the worst case/i)
  })

  it('recommended timeout is at least 1.5× typical and fits the hop budget share', () => {
    const r = calc.execute(base)
    for (const h of r.hops) {
      expect(h.recommendedTimeoutMs).toBeGreaterThanOrEqual(
        Math.ceil(base.hops.find((x) => x.name === h.name)!.typicalMs * 1.5),
      )
    }
  })

  it('summary lists every hop and the fit verdict', () => {
    const r = calc.execute(base)
    expect(r.summaryText).toMatch(/gateway/)
    expect(r.summaryText).toMatch(/database/)
    expect(r.summaryText).toMatch(/FITS|OVER BUDGET/)
  })

  it('rejects bad inputs', () => {
    expect(() => calc.execute({ ...base, endToEndBudgetMs: 0 })).toThrow()
    expect(() => calc.execute({ ...base, hops: [] })).toThrow()
    expect(() => calc.execute({ ...base, hops: [{ name: 'x', typicalMs: 0, timeoutMs: 1, retries: 0, backoffBaseMs: 0 }] })).toThrow()
    expect(() => calc.execute({ ...base, hops: [{ name: 'x', typicalMs: 1, timeoutMs: 1, retries: -1, backoffBaseMs: 0 }] })).toThrow()
  })
})
