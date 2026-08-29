import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * SLO & Error Budget calculator — pure math, no I/O, no React.
 *
 *   error budget (fraction) = 1 − SLO
 *   allowed downtime / window = window × error-budget-fraction
 *   allowed bad requests      = requests-in-window × error-budget-fraction
 *
 * When a current success rate is given, the budget consumed so far is
 * `(1 − success) / error-budget-fraction`.
 *
 * Multi-window, multi-burn-rate alerts (Google SRE Workbook, "Alerting on
 * SLOs"): a burn rate of B means the budget is being spent B× faster than
 * "sustainable", i.e. it would be exhausted in `window / B`. The classic
 * page/ticket thresholds:
 *
 *   | severity | budget in time  | burn rate | long win | short win |
 *   |----------|-----------------|-----------|----------|-----------|
 *   | page     | 2% in 1 hour    | 14.4      | 1h       | 5m        |
 *   | page     | 5% in 6 hours   | 6         | 6h       | 30m       |
 *   | ticket   | 10% in 3 days   | 1         | 3d       | 6h        |
 *
 * The alert fires only when BOTH windows exceed `burnRate × error-budget`
 * error ratio — the short window makes it reset quickly once the burn stops.
 */

export interface SloErrorBudgetInput {
  /** SLO target as a percentage in (0, 100), e.g. 99.9. */
  sloTargetPercent: number
  /** Rolling window length in days (commonly 28, 30, or 90). */
  windowDays: number
  /** Optional: current measured success rate percent, to show budget consumed. */
  currentSuccessRatePercent?: number
  /** Optional: request volume per day, to express the budget as a bad-request count. */
  requestsPerDay?: number
}

export interface BurnRateThreshold {
  severity: 'page' | 'ticket'
  /** Human note, e.g. "2% of budget in 1 hour". */
  label: string
  burnRate: number
  longWindow: string
  shortWindow: string
  /** Error ratio that trips this threshold = burnRate × errorBudgetFraction. */
  errorRatioThreshold: number
}

export interface SloErrorBudgetResult {
  errorBudgetFraction: number
  /** Allowed downtime across the whole window, in minutes. */
  allowedDowntimeMinutesPerWindow: number
  allowedDowntimeMinutesPerDay: number
  allowedDowntimeMinutesPerWeek: number
  /** null unless `requestsPerDay` was given. */
  allowedBadRequestsPerWindow: number | null
  /** null unless `currentSuccessRatePercent` was given. */
  budgetConsumedPercent: number | null
  budgetRemainingPercent: number | null
  thresholds: BurnRateThreshold[]
  /** Prometheus multi-window burn-rate alert rule. */
  prometheusRule: string
}

const BURN_SPECS: { severity: 'page' | 'ticket'; budgetFraction: number; overHours: number; longWindow: string; shortWindow: string }[] = [
  { severity: 'page', budgetFraction: 0.02, overHours: 1, longWindow: '1h', shortWindow: '5m' },
  { severity: 'page', budgetFraction: 0.05, overHours: 6, longWindow: '6h', shortWindow: '30m' },
  { severity: 'ticket', budgetFraction: 0.1, overHours: 72, longWindow: '3d', shortWindow: '6h' },
]

export class SloErrorBudget implements IToolUseCase<SloErrorBudgetInput, SloErrorBudgetResult> {
  execute(input: SloErrorBudgetInput): SloErrorBudgetResult {
    if (input.sloTargetPercent <= 0 || input.sloTargetPercent >= 100)
      throw new Error('sloTargetPercent must be in (0, 100)')
    if (input.windowDays <= 0) throw new Error('windowDays must be positive')
    if (input.currentSuccessRatePercent != null && (input.currentSuccessRatePercent < 0 || input.currentSuccessRatePercent > 100))
      throw new Error('currentSuccessRatePercent must be in [0, 100]')
    if (input.requestsPerDay != null && input.requestsPerDay <= 0)
      throw new Error('requestsPerDay must be positive')

    const errorBudgetFraction = 1 - input.sloTargetPercent / 100
    const windowMinutes = input.windowDays * 24 * 60

    const allowedDowntimeMinutesPerWindow = windowMinutes * errorBudgetFraction
    const allowedDowntimeMinutesPerDay = 24 * 60 * errorBudgetFraction
    const allowedDowntimeMinutesPerWeek = 7 * 24 * 60 * errorBudgetFraction

    const allowedBadRequestsPerWindow =
      input.requestsPerDay != null ? input.requestsPerDay * input.windowDays * errorBudgetFraction : null

    let budgetConsumedPercent: number | null = null
    let budgetRemainingPercent: number | null = null
    if (input.currentSuccessRatePercent != null) {
      const observedErrorFraction = 1 - input.currentSuccessRatePercent / 100
      budgetConsumedPercent = (observedErrorFraction / errorBudgetFraction) * 100
      budgetRemainingPercent = 100 - budgetConsumedPercent
    }

    const thresholds: BurnRateThreshold[] = BURN_SPECS.map((spec) => {
      // burn rate B such that B% ... actually: to spend `budgetFraction` of the
      // budget in `overHours`, the budget must burn at
      // B = budgetFraction / (overHours / windowHours).
      const windowHours = input.windowDays * 24
      const burnRate = spec.budgetFraction / (spec.overHours / windowHours)
      return {
        severity: spec.severity,
        label: `${(spec.budgetFraction * 100).toFixed(0)}% of budget in ${humanHours(spec.overHours)}`,
        burnRate,
        longWindow: spec.longWindow,
        shortWindow: spec.shortWindow,
        errorRatioThreshold: burnRate * errorBudgetFraction,
      }
    })

    return {
      errorBudgetFraction,
      allowedDowntimeMinutesPerWindow,
      allowedDowntimeMinutesPerDay,
      allowedDowntimeMinutesPerWeek,
      allowedBadRequestsPerWindow,
      budgetConsumedPercent,
      budgetRemainingPercent,
      thresholds,
      prometheusRule: renderPrometheus(input, thresholds),
    }
  }
}

function humanHours(h: number): string {
  if (h >= 24) return `${h / 24} day${h === 24 ? '' : 's'}`
  return `${h} hour${h === 1 ? '' : 's'}`
}

function renderPrometheus(input: SloErrorBudgetInput, thresholds: BurnRateThreshold[]): string {
  const lines = [
    '# Prometheus multi-window burn-rate alerts — generated by InfraKit Studio.',
    `# SLO ${input.sloTargetPercent}% over ${input.windowDays}d. Replace the sli:error_ratio recording rule`,
    '# with your own (failed requests ÷ total requests over each window).',
    'groups:',
    '  - name: slo-burn-rate',
    '    rules:',
  ]
  for (const t of thresholds) {
    const name = t.severity === 'page' ? `ErrorBudgetBurn_${t.longWindow}` : `ErrorBudgetBurnSlow_${t.longWindow}`
    lines.push(
      `      - alert: ${name}`,
      `        expr: |`,
      `          sli:error_ratio:rate${t.longWindow} > ${t.errorRatioThreshold.toExponential(2)}`,
      `          and`,
      `          sli:error_ratio:rate${t.shortWindow} > ${t.errorRatioThreshold.toExponential(2)}`,
      `        for: ${t.severity === 'page' ? '2m' : '15m'}`,
      `        labels: { severity: ${t.severity}, burn_rate: "${round2(t.burnRate)}" }`,
      `        annotations:`,
      `          summary: "Error budget burning at ${round2(t.burnRate)}× (${t.label})"`,
    )
  }
  return lines.join('\n')
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
