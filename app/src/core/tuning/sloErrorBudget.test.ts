import { describe, expect, it } from 'vitest'
import { SloErrorBudget, type SloErrorBudgetInput } from './sloErrorBudget'

const calc = new SloErrorBudget()

const base: SloErrorBudgetInput = { sloTargetPercent: 99.9, windowDays: 30 }

describe('SloErrorBudget', () => {
  it('99.9% → 0.1% error budget', () => {
    expect(calc.execute(base).errorBudgetFraction).toBeCloseTo(0.001, 12)
  })

  it('allowed downtime: 99.9% over 30d ≈ 43.2 min; per day ≈ 1.44 min', () => {
    const r = calc.execute(base)
    expect(r.allowedDowntimeMinutesPerWindow).toBeCloseTo(30 * 24 * 60 * 0.001, 6) // 43.2
    expect(r.allowedDowntimeMinutesPerDay).toBeCloseTo(1.44, 6)
    expect(r.allowedDowntimeMinutesPerWeek).toBeCloseTo(10.08, 6)
  })

  it('three nines over 90d ≈ 129.6 min', () => {
    expect(calc.execute({ sloTargetPercent: 99.9, windowDays: 90 }).allowedDowntimeMinutesPerWindow).toBeCloseTo(
      129.6,
      6,
    )
  })

  it('bad-request budget when requestsPerDay is given', () => {
    const r = calc.execute({ ...base, requestsPerDay: 10_000_000 })
    expect(r.allowedBadRequestsPerWindow).toBeCloseTo(10_000_000 * 30 * 0.001, 3) // 300k
  })
  it('bad-request budget is null otherwise', () => {
    expect(calc.execute(base).allowedBadRequestsPerWindow).toBeNull()
  })

  it('budget consumed: success 99.95% against a 99.9% SLO → 50% consumed', () => {
    const r = calc.execute({ ...base, currentSuccessRatePercent: 99.95 })
    expect(r.budgetConsumedPercent).toBeCloseTo(50, 6)
    expect(r.budgetRemainingPercent).toBeCloseTo(50, 6)
  })
  it('budget over-consumed: success 99.8% → 200% consumed, −100% remaining', () => {
    const r = calc.execute({ ...base, currentSuccessRatePercent: 99.8 })
    expect(r.budgetConsumedPercent).toBeCloseTo(200, 6)
    expect(r.budgetRemainingPercent).toBeCloseTo(-100, 6)
  })
  it('budget fields are null without a current success rate', () => {
    expect(calc.execute(base).budgetConsumedPercent).toBeNull()
  })

  it('classic 30-day burn rates: 14.4 / 6 / 1', () => {
    const r = calc.execute(base)
    const rates = r.thresholds.map((t) => Math.round(t.burnRate * 100) / 100)
    expect(rates).toEqual([14.4, 6, 1])
  })

  it('burn rates scale with window length (28d)', () => {
    const r = calc.execute({ ...base, windowDays: 28 })
    expect(r.thresholds[0].burnRate).toBeCloseTo(0.02 * (28 * 24) / 1, 6) // 13.44
  })

  it('error-ratio threshold = burnRate × errorBudgetFraction', () => {
    const r = calc.execute(base)
    for (const t of r.thresholds) {
      expect(t.errorRatioThreshold).toBeCloseTo(t.burnRate * 0.001, 12)
    }
  })

  it('emits a Prometheus rule group with a page and a ticket alert', () => {
    const r = calc.execute(base)
    expect(r.prometheusRule).toContain('name: slo-burn-rate')
    expect(r.prometheusRule).toContain('severity: page')
    expect(r.prometheusRule).toContain('severity: ticket')
    expect(r.prometheusRule).toContain('sli:error_ratio:rate1h')
    expect(r.prometheusRule).toContain('sli:error_ratio:rate5m')
  })

  it('rejects bad inputs', () => {
    expect(() => calc.execute({ ...base, sloTargetPercent: 0 })).toThrow()
    expect(() => calc.execute({ ...base, sloTargetPercent: 100 })).toThrow()
    expect(() => calc.execute({ ...base, windowDays: 0 })).toThrow()
    expect(() => calc.execute({ ...base, currentSuccessRatePercent: 120 })).toThrow()
    expect(() => calc.execute({ ...base, requestsPerDay: 0 })).toThrow()
  })
})
