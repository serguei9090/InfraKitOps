import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Capacity Runway — pure math, no I/O, no React.
 *
 * Projects a single resource forward against a ceiling and says when you run
 * out and when you have to act.
 *
 *   linear    usage(t) = current + rate · t          (rate = units / month)
 *   compound  usage(t) = current · (1 + rate/100)^t  (rate = % / month)
 *
 *   months to ceiling  — solve usage(t) = ceiling
 *   trigger point      — usage(t) = ceiling · (1 − targetHeadroom)
 *   order-by month     — trigger point, or (months to ceiling − lead time),
 *                        whichever is sooner
 *
 * One resource, one growth rate, no seasonality — a planning aid, not a
 * forecast. Feed it p95 or trend-line numbers, not a single spike.
 */

export type GrowthModel = 'linear' | 'compound'

export interface CapacityRunwayInput {
  /** Current usage, in whatever unit `unit` names. */
  currentUsage: number
  /** The hard limit in the same unit. */
  ceiling: number
  growthModel: GrowthModel
  /** linear: units added per month. compound: percent growth per month. */
  growthRate: number
  /** Months it takes to provision more capacity once you decide to. Default 1. */
  orderLeadTimeMonths?: number
  /** Act when headroom drops to this fraction of the ceiling, 0-100. Default 20. */
  targetHeadroomPercent?: number
  /** How far out to project, months. Default 24. */
  projectionMonths?: number
  /** Unit label for the summary, e.g. "GiB", "req/s". Default "units". */
  unit?: string
}

export interface RunwayPoint {
  month: number
  usage: number
  headroomPercent: number
  overCeiling: boolean
}

export interface CapacityRunwayResult {
  currentHeadroomPercent: number
  /** Months until usage reaches the ceiling. Infinity when growth is ≤ 0. */
  monthsToCeiling: number
  /** Months until usage reaches the trigger (ceiling − target headroom). */
  monthsToTrigger: number
  /** When to start provisioning: min(monthsToTrigger, monthsToCeiling − lead time). Can be ≤ 0. */
  orderByMonth: number
  /** True when you're already past the point where you should have ordered. */
  actNow: boolean
  projection: RunwayPoint[]
  summaryText: string
}

export class CapacityRunway implements IToolUseCase<CapacityRunwayInput, CapacityRunwayResult> {
  execute(input: CapacityRunwayInput): CapacityRunwayResult {
    const leadTime = input.orderLeadTimeMonths ?? 1
    const targetHeadroom = (input.targetHeadroomPercent ?? 20) / 100
    const projectionMonths = input.projectionMonths ?? 24
    const unit = input.unit ?? 'units'

    if (input.currentUsage < 0) throw new Error('currentUsage must be ≥ 0')
    if (input.ceiling <= 0) throw new Error('ceiling must be positive')
    if (leadTime < 0) throw new Error('orderLeadTimeMonths must be ≥ 0')
    if (targetHeadroom < 0 || targetHeadroom >= 1) throw new Error('targetHeadroomPercent must be in [0, 100)')
    if (projectionMonths <= 0) throw new Error('projectionMonths must be positive')
    if (input.growthModel === 'compound' && input.growthRate <= -100)
      throw new Error('compound growthRate must be > −100%')

    const usageAt = (t: number): number =>
      input.growthModel === 'linear'
        ? input.currentUsage + input.growthRate * t
        : input.currentUsage * (1 + input.growthRate / 100) ** t

    const solveFor = (level: number): number => {
      if (input.currentUsage >= level) return 0
      if (input.growthModel === 'linear') {
        if (input.growthRate <= 0) return Infinity
        return (level - input.currentUsage) / input.growthRate
      }
      if (input.growthRate <= 0) return Infinity
      return Math.log(level / input.currentUsage) / Math.log(1 + input.growthRate / 100)
    }

    const monthsToCeiling = solveFor(input.ceiling)
    const triggerLevel = input.ceiling * (1 - targetHeadroom)
    const monthsToTrigger = solveFor(triggerLevel)
    const orderByMonth = Math.min(
      monthsToTrigger,
      Number.isFinite(monthsToCeiling) ? monthsToCeiling - leadTime : Infinity,
    )
    const actNow = orderByMonth <= 0

    const currentHeadroomPercent = ((input.ceiling - input.currentUsage) / input.ceiling) * 100

    const marks = [0, 1, 3, 6, 9, 12, 18, 24].filter((m) => m <= projectionMonths)
    if (!marks.includes(projectionMonths)) marks.push(projectionMonths)
    const projection: RunwayPoint[] = marks.map((month) => {
      const usage = usageAt(month)
      return {
        month,
        usage,
        headroomPercent: ((input.ceiling - usage) / input.ceiling) * 100,
        overCeiling: usage >= input.ceiling,
      }
    })

    return {
      currentHeadroomPercent,
      monthsToCeiling,
      monthsToTrigger,
      orderByMonth,
      actNow,
      projection,
      summaryText: renderSummary(input, unit, {
        currentHeadroomPercent,
        monthsToCeiling,
        monthsToTrigger,
        orderByMonth,
        actNow,
      }),
    }
  }
}

function humanMonths(m: number): string {
  if (!Number.isFinite(m)) return 'never (flat or shrinking)'
  if (m <= 0) return 'now — already past it'
  if (m < 1) return `${Math.round(m * 30)} days`
  if (m < 24) return `${m.toFixed(1)} months`
  return `${(m / 12).toFixed(1)} years`
}

function renderSummary(
  input: CapacityRunwayInput,
  unit: string,
  r: {
    currentHeadroomPercent: number
    monthsToCeiling: number
    monthsToTrigger: number
    orderByMonth: number
    actNow: boolean
  },
): string {
  const model =
    input.growthModel === 'linear'
      ? `+${input.growthRate} ${unit}/month (linear)`
      : `${input.growthRate}%/month (compound)`
  return [
    `Now: ${input.currentUsage} / ${input.ceiling} ${unit} — ${r.currentHeadroomPercent.toFixed(0)}% headroom`,
    `Growth: ${model}`,
    '',
    `Hits the ceiling in:        ${humanMonths(r.monthsToCeiling)}`,
    `Drops below target headroom: ${humanMonths(r.monthsToTrigger)}`,
    `Start provisioning by:      ${humanMonths(r.orderByMonth)}` + (r.actNow ? '  ← ACT NOW' : ''),
    '',
    'One resource, one growth rate, no seasonality — feed it trend-line numbers.',
  ].join('\n')
}
