import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Cloud Right-Size & Commitment — pure math, no I/O, no React.
 *
 * Two questions in one:
 *  1. **Right-size** — given observed p95 CPU/RAM utilisation and a target
 *     utilisation (leave headroom), what instance size should this actually
 *     be? `neededVcpu = currentVcpu · p95 / target`, rounded up to the next
 *     common size; same for RAM; the larger dimension wins.
 *  2. **Commitment** — for the right-sized fleet, compare on-demand vs a
 *     reserved / savings-plan commitment vs a spot mix. A reservation is
 *     cheaper than on-demand only when the instance runs more than
 *     `1 − discount` of the time — that's the **break-even utilisation**.
 *
 * Price is assumed roughly linear in instance size within a family, which is
 * close enough for planning but not exact — check the provider's price list
 * for the specific SKUs.
 */

const COMMON_SIZES = [1, 2, 4, 8, 16, 32, 48, 64, 96, 128, 192, 256]

function nextCommonSize(n: number): number {
  for (const s of COMMON_SIZES) if (s >= n) return s
  return Math.ceil(n / 64) * 64
}

export interface CloudRightSizeInput {
  currentVcpu: number
  currentRamGb: number
  /** Observed p95 CPU utilisation, percent. */
  observedCpuP95Percent: number
  /** Observed p95 memory utilisation, percent. */
  observedRamP95Percent: number
  /** Utilisation the right-sized instance should sit at under p95 load. Default 60. */
  targetUtilizationPercent?: number
  /** On-demand price per hour for the CURRENT instance. */
  onDemandHourly: number
  /** Hours the instance is billed per month. Default 730. */
  hoursPerMonth?: number
  /** Number of instances in the fleet. Default 1. */
  instanceCount?: number
  /** Reserved-instance / savings-plan discount vs on-demand, percent. Default 40. */
  reservedDiscountPercent?: number
  /** Spot discount vs on-demand, percent. Default 70. */
  spotDiscountPercent?: number
  /** Fraction of the fleet that can tolerate spot interruption, 0-100. Default 0. */
  spotFractionPercent?: number
  /** Commitment term, years (1 or 3) — informational, shown in the summary. Default 1. */
  commitmentTermYears?: number
}

export interface CloudRightSizeResult {
  recommendedVcpu: number
  recommendedRamGb: number
  /** 'cpu' | 'ram' — which dimension set the recommended size. */
  bindingDimension: 'cpu' | 'ram'
  /** recommendedVcpu / currentVcpu (or the RAM ratio, whichever binds) — the price scale factor. */
  sizeRatio: number
  /** Right-sized on-demand price per hour per instance. */
  rightSizedHourly: number

  monthlyCurrent: number
  monthlyRightSizedOnDemand: number
  monthlyRightSizedReserved: number
  monthlyRightSizedSpotMix: number

  savingVsCurrentOnDemand: number
  savingVsCurrentReserved: number
  savingVsCurrentSpotMix: number

  /** Running fraction above which a reservation beats on-demand, percent. */
  reservedBreakEvenUtilPercent: number
  summaryText: string
}

export class CloudRightSize implements IToolUseCase<CloudRightSizeInput, CloudRightSizeResult> {
  execute(input: CloudRightSizeInput): CloudRightSizeResult {
    const target = (input.targetUtilizationPercent ?? 60) / 100
    const hoursPerMonth = input.hoursPerMonth ?? 730
    const instanceCount = input.instanceCount ?? 1
    const riDisc = (input.reservedDiscountPercent ?? 40) / 100
    const spotDisc = (input.spotDiscountPercent ?? 70) / 100
    const spotFraction = (input.spotFractionPercent ?? 0) / 100
    const term = input.commitmentTermYears ?? 1

    if (input.currentVcpu <= 0 || input.currentRamGb <= 0) throw new Error('current vCPU and RAM must be positive')
    if (input.observedCpuP95Percent < 0 || input.observedRamP95Percent < 0)
      throw new Error('observed utilisation must be ≥ 0')
    if (target <= 0 || target > 1) throw new Error('targetUtilizationPercent must be in (0, 100]')
    if (input.onDemandHourly <= 0) throw new Error('onDemandHourly must be positive')
    if (!Number.isInteger(instanceCount) || instanceCount < 1) throw new Error('instanceCount must be an integer ≥ 1')
    for (const [name, v] of [
      ['reservedDiscountPercent', riDisc],
      ['spotDiscountPercent', spotDisc],
      ['spotFractionPercent', spotFraction],
    ] as const) {
      if (v < 0 || v >= 1) throw new Error(`${name} must be in [0, 100)`)
    }

    const neededVcpu = (input.currentVcpu * (input.observedCpuP95Percent / 100)) / target
    const neededRamGb = (input.currentRamGb * (input.observedRamP95Percent / 100)) / target
    const recommendedVcpu = Math.max(1, nextCommonSize(neededVcpu))
    const recommendedRamGb = Math.max(1, nextCommonSize(neededRamGb))

    const cpuRatio = recommendedVcpu / input.currentVcpu
    const ramRatio = recommendedRamGb / input.currentRamGb
    const bindingDimension: 'cpu' | 'ram' = cpuRatio >= ramRatio ? 'cpu' : 'ram'
    const sizeRatio = Math.max(cpuRatio, ramRatio)
    const rightSizedHourly = input.onDemandHourly * sizeRatio

    const fleetMonth = (hourly: number) => hourly * hoursPerMonth * instanceCount

    const monthlyCurrent = fleetMonth(input.onDemandHourly)
    const monthlyRightSizedOnDemand = fleetMonth(rightSizedHourly)
    const monthlyRightSizedReserved = fleetMonth(rightSizedHourly * (1 - riDisc))

    // Spot mix: `spotFraction` of the fleet on spot, the rest reserved.
    const spotPart = spotFraction * rightSizedHourly * (1 - spotDisc)
    const reservedPart = (1 - spotFraction) * rightSizedHourly * (1 - riDisc)
    const monthlyRightSizedSpotMix = (spotPart + reservedPart) * hoursPerMonth * instanceCount

    const reservedBreakEvenUtilPercent = (1 - riDisc) * 100

    return {
      recommendedVcpu,
      recommendedRamGb,
      bindingDimension,
      sizeRatio,
      rightSizedHourly,
      monthlyCurrent,
      monthlyRightSizedOnDemand,
      monthlyRightSizedReserved,
      monthlyRightSizedSpotMix,
      savingVsCurrentOnDemand: monthlyCurrent - monthlyRightSizedOnDemand,
      savingVsCurrentReserved: monthlyCurrent - monthlyRightSizedReserved,
      savingVsCurrentSpotMix: monthlyCurrent - monthlyRightSizedSpotMix,
      reservedBreakEvenUtilPercent,
      summaryText: renderSummary(input, term, {
        recommendedVcpu,
        recommendedRamGb,
        bindingDimension,
        monthlyCurrent,
        monthlyRightSizedOnDemand,
        monthlyRightSizedReserved,
        monthlyRightSizedSpotMix,
        reservedBreakEvenUtilPercent,
      }),
    }
  }
}

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function renderSummary(
  input: CloudRightSizeInput,
  term: number,
  r: {
    recommendedVcpu: number
    recommendedRamGb: number
    bindingDimension: 'cpu' | 'ram'
    monthlyCurrent: number
    monthlyRightSizedOnDemand: number
    monthlyRightSizedReserved: number
    monthlyRightSizedSpotMix: number
    reservedBreakEvenUtilPercent: number
  },
): string {
  const pct = (from: number, to: number) => `${(((from - to) / from) * 100).toFixed(0)}%`
  return [
    `Current: ${input.currentVcpu} vCPU / ${input.currentRamGb} GiB @ p95 ${input.observedCpuP95Percent}% CPU, ${input.observedRamP95Percent}% RAM`,
    `Right-size to: ${r.recommendedVcpu} vCPU / ${r.recommendedRamGb} GiB (${r.bindingDimension}-bound)`,
    '',
    `Monthly (fleet):`,
    `  current on-demand:        ${money(r.monthlyCurrent)}`,
    `  right-sized on-demand:    ${money(r.monthlyRightSizedOnDemand)}  (−${pct(r.monthlyCurrent, r.monthlyRightSizedOnDemand)})`,
    `  right-sized ${term}yr reserved:  ${money(r.monthlyRightSizedReserved)}  (−${pct(r.monthlyCurrent, r.monthlyRightSizedReserved)})`,
    `  right-sized spot mix:     ${money(r.monthlyRightSizedSpotMix)}  (−${pct(r.monthlyCurrent, r.monthlyRightSizedSpotMix)})`,
    '',
    `Reserve only if the instance runs > ${r.reservedBreakEvenUtilPercent.toFixed(0)}% of the time (break-even).`,
    'Price assumed linear in size — confirm against the provider price list.',
  ].join('\n')
}
