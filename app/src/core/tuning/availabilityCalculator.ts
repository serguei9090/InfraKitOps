import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Availability & Redundancy calculator — pure math, no I/O, no React.
 *
 *   A from MTBF/MTTR   A = MTBF / (MTBF + MTTR)
 *   k-of-n redundancy  P(≥k up) = Σ_{i=k..n} C(n,i) · A^i · (1−A)^(n−i)
 *   series (all needed) A_sys = Π A_i
 *   parallel (any one)  A_sys = 1 − Π (1 − A_i)
 *   "nines"            −log10(1 − A)
 *   downtime / year    (1 − A) · 525 600 minutes
 *
 * A dependency chain is `series`: every tier has to be up. A redundant pool
 * is modelled per-component with `redundancy` (a load balancer with 3
 * members, 2 needed = k-of-n with n=3, k=2 ≈ "N+1").
 *
 * Independence is assumed — correlated failure (shared power, one bad
 * deploy, a poisoned config) is the usual reason real systems miss the
 * number this predicts. Treat it as an upper bound.
 */

export type Topology = 'series' | 'parallel'

export interface AvailabilityComponentInput {
  name: string
  /** Availability of ONE instance, as a percent in (0, 100]. Either this or MTBF+MTTR. */
  availabilityPercent?: number
  /** Mean time between failures, hours. Used with `mttrHours` when `availabilityPercent` is absent. */
  mtbfHours?: number
  /** Mean time to repair, hours. */
  mttrHours?: number
  /** Redundant pool: `total` instances, `required` must be up. Omit for a single instance. */
  redundancy?: { total: number; required: number }
}

export interface AvailabilityCalculatorInput {
  components: AvailabilityComponentInput[]
  /** How the components combine. `series` = every one must be up (a dependency chain). */
  topology: Topology
  /** Optional target availability percent, for the gap analysis. */
  targetPercent?: number
}

export interface ComponentAvailability {
  name: string
  /** Availability of one instance. */
  instanceAvailability: number
  /** Effective availability after redundancy (= instance availability when there's no pool). */
  effectiveAvailability: number
  redundancy: { total: number; required: number } | null
  /** Effective availability if one more redundant instance were added (null when not a pool). */
  availabilityWithOneMore: number | null
}

export interface AvailabilityCalculatorResult {
  components: ComponentAvailability[]
  systemAvailability: number
  /** systemAvailability as a percent, e.g. 99.9873. */
  systemAvailabilityPercent: number
  nines: number
  downtimePerYearMinutes: number
  downtimePerMonthMinutes: number
  downtimePerWeekMinutes: number
  /** null unless a target was given. */
  meetsTarget: boolean | null
  /** Extra downtime per year vs the target, minutes (negative = better than target). */
  gapToTargetMinutesPerYear: number | null
  summaryText: string
}

const MIN_PER_YEAR = 365.25 * 24 * 60

function binomialCoefficient(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let c = 1
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1)
  return c
}

/** P(at least `required` of `total` independent instances are up). */
export function kOfNAvailability(instanceAvailability: number, total: number, required: number): number {
  let p = 0
  for (let i = required; i <= total; i++) {
    p +=
      binomialCoefficient(total, i) *
      instanceAvailability ** i *
      (1 - instanceAvailability) ** (total - i)
  }
  return p
}

export function nines(availability: number): number {
  if (availability >= 1) return Infinity
  return -Math.log10(1 - availability)
}

export class AvailabilityCalculator
  implements IToolUseCase<AvailabilityCalculatorInput, AvailabilityCalculatorResult>
{
  execute(input: AvailabilityCalculatorInput): AvailabilityCalculatorResult {
    if (input.components.length === 0) throw new Error('Add at least one component.')

    const components: ComponentAvailability[] = input.components.map((c) => {
      const instanceAvailability = this.instanceAvailability(c)
      let effectiveAvailability = instanceAvailability
      let availabilityWithOneMore: number | null = null
      let redundancy: { total: number; required: number } | null = null

      if (c.redundancy) {
        const { total, required } = c.redundancy
        if (!Number.isInteger(total) || !Number.isInteger(required) || required < 1 || required > total)
          throw new Error(`"${c.name}": redundancy needs 1 ≤ required ≤ total.`)
        redundancy = { total, required }
        effectiveAvailability = kOfNAvailability(instanceAvailability, total, required)
        availabilityWithOneMore = kOfNAvailability(instanceAvailability, total + 1, required)
      }

      return { name: c.name, instanceAvailability, effectiveAvailability, redundancy, availabilityWithOneMore }
    })

    const effs = components.map((c) => c.effectiveAvailability)
    const systemAvailability =
      input.topology === 'series'
        ? effs.reduce((acc, a) => acc * a, 1)
        : 1 - effs.reduce((acc, a) => acc * (1 - a), 1)

    const downtimePerYearMinutes = (1 - systemAvailability) * MIN_PER_YEAR
    const systemAvailabilityPercent = systemAvailability * 100

    let meetsTarget: boolean | null = null
    let gapToTargetMinutesPerYear: number | null = null
    if (input.targetPercent != null) {
      if (input.targetPercent <= 0 || input.targetPercent >= 100)
        throw new Error('targetPercent must be in (0, 100)')
      const target = input.targetPercent / 100
      meetsTarget = systemAvailability >= target
      gapToTargetMinutesPerYear = (target - systemAvailability) * MIN_PER_YEAR
    }

    return {
      components,
      systemAvailability,
      systemAvailabilityPercent,
      nines: nines(systemAvailability),
      downtimePerYearMinutes,
      downtimePerMonthMinutes: (1 - systemAvailability) * (MIN_PER_YEAR / 12),
      downtimePerWeekMinutes: (1 - systemAvailability) * (7 * 24 * 60),
      meetsTarget,
      gapToTargetMinutesPerYear,
      summaryText: renderSummary(input, components, systemAvailabilityPercent, downtimePerYearMinutes),
    }
  }

  private instanceAvailability(c: AvailabilityComponentInput): number {
    if (c.availabilityPercent != null) {
      if (c.availabilityPercent <= 0 || c.availabilityPercent > 100)
        throw new Error(`"${c.name}": availabilityPercent must be in (0, 100].`)
      return c.availabilityPercent / 100
    }
    if (c.mtbfHours != null && c.mttrHours != null) {
      if (c.mtbfHours <= 0 || c.mttrHours <= 0)
        throw new Error(`"${c.name}": mtbfHours and mttrHours must be positive.`)
      return c.mtbfHours / (c.mtbfHours + c.mttrHours)
    }
    throw new Error(`"${c.name}": give either an availability % or both MTBF and MTTR.`)
  }
}

function fmtPct(p: number): string {
  return `${p.toFixed(p >= 99.99 ? 5 : p >= 99 ? 3 : 2)}%`
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${min.toFixed(1)} min`
  if (min < 1440) return `${(min / 60).toFixed(1)} h`
  return `${(min / 1440).toFixed(1)} d`
}

function renderSummary(
  input: AvailabilityCalculatorInput,
  components: ComponentAvailability[],
  systemPercent: number,
  downtimePerYearMinutes: number,
): string {
  const lines = [
    `System availability (${input.topology}): ${fmtPct(systemPercent)}`,
    `≈ ${nines(systemPercent / 100).toFixed(2)} nines · ${fmtMinutes(downtimePerYearMinutes)} downtime / year`,
    '',
    'Components:',
  ]
  for (const c of components) {
    const red = c.redundancy ? ` [${c.redundancy.required}-of-${c.redundancy.total}]` : ''
    lines.push(
      `  ${c.name}${red}: instance ${fmtPct(c.instanceAvailability * 100)} → effective ${fmtPct(c.effectiveAvailability * 100)}` +
        (c.availabilityWithOneMore != null
          ? ` (one more instance → ${fmtPct(c.availabilityWithOneMore * 100)})`
          : ''),
    )
  }
  lines.push('', 'Assumes independent failures — correlated failure will do worse.')
  return lines.join('\n')
}
