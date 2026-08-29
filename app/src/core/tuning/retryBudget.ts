import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Retry & Timeout Budget — pure math, no I/O, no React.
 *
 * A request walks a chain of hops (gateway → service A → service B → DB).
 * Each hop has a typical latency, a timeout, and a retry policy. Two things
 * go wrong when this isn't budgeted:
 *
 *  1. **Latency blows the budget.** Worst case for one hop is every retry
 *     timing out, then the last attempt succeeding:
 *       hop worst = retries · timeout + successAttempt + Σ backoff
 *     (exponential backoff Σ = base · (2^retries − 1); jitter only helps the
 *     average, not the worst case). The chain's worst case is the sum.
 *
 *  2. **Retry amplification.** If every layer retries the whole thing
 *     downstream, the innermost service can see `Π (1 + retriesᵢ)` attempts
 *     per user request — the classic retry storm. Anything above ~3–4× is a
 *     cascading-failure risk.
 *
 * Recommended timeouts split the end-to-end budget so retries fit and each
 * outer hop's timeout comfortably exceeds everything below it.
 */

export interface RetryHopInput {
  name: string
  /** Typical (p50-ish) latency for one successful attempt, ms. */
  typicalMs: number
  /** Per-attempt timeout, ms. */
  timeoutMs: number
  /** Retries *after* the first attempt. 0 = no retry. */
  retries: number
  /** Base backoff between retries, ms. Grows exponentially (base, 2·base, 4·base…). */
  backoffBaseMs: number
}

export interface RetryBudgetInput {
  /** End-to-end latency budget for the whole request, ms. */
  endToEndBudgetMs: number
  /** Hops in call order, outer → inner. */
  hops: RetryHopInput[]
}

export interface RetryHopResult {
  name: string
  attempts: number
  totalBackoffMs: number
  /** retries · timeout + successAttempt + Σ backoff. */
  worstCaseMs: number
  /** Timeout that would keep this hop (with its retries) inside its share of the budget. */
  recommendedTimeoutMs: number
  /** true when the current timeout × attempts already exceeds this hop's budget share. */
  overBudgetShare: boolean
  /** true when this hop's timeout is not comfortably larger than everything below it. */
  timeoutTooTightForDownstream: boolean
}

export interface RetryBudgetResult {
  hops: RetryHopResult[]
  worstCaseTotalMs: number
  fitsBudget: boolean
  /** Π (1 + retriesᵢ) — max attempts the innermost hop can see per request. */
  retryAmplification: number
  /** Downstream-request multiplier that is a retry-storm risk (> ~3–4). */
  amplificationRisk: boolean
  warnings: string[]
  summaryText: string
}

function hopWorstCase(hop: RetryHopInput): { attempts: number; backoff: number; worst: number } {
  const attempts = 1 + Math.max(0, hop.retries)
  const backoff = hop.backoffBaseMs * (2 ** Math.max(0, hop.retries) - 1)
  const success = Math.min(hop.typicalMs, hop.timeoutMs)
  const worst = Math.max(0, hop.retries) * hop.timeoutMs + success + backoff
  return { attempts, backoff, worst }
}

export class RetryBudget implements IToolUseCase<RetryBudgetInput, RetryBudgetResult> {
  execute(input: RetryBudgetInput): RetryBudgetResult {
    if (input.endToEndBudgetMs <= 0) throw new Error('endToEndBudgetMs must be positive')
    if (input.hops.length === 0) throw new Error('Add at least one hop.')
    for (const h of input.hops) {
      if (h.typicalMs <= 0) throw new Error(`"${h.name}": typicalMs must be positive`)
      if (h.timeoutMs <= 0) throw new Error(`"${h.name}": timeoutMs must be positive`)
      if (!Number.isInteger(h.retries) || h.retries < 0) throw new Error(`"${h.name}": retries must be an integer ≥ 0`)
      if (h.backoffBaseMs < 0) throw new Error(`"${h.name}": backoffBaseMs must be ≥ 0`)
    }

    const n = input.hops.length
    const perHopBudget = input.endToEndBudgetMs / n
    const warnings: string[] = []

    // Worst case below hop i (sum of hop worst-cases for i+1 .. n-1).
    const worstBelow: number[] = new Array(n).fill(0)
    for (let i = n - 2; i >= 0; i--) {
      worstBelow[i] = worstBelow[i + 1] + hopWorstCase(input.hops[i + 1]).worst
    }

    const hops: RetryHopResult[] = input.hops.map((hop, i) => {
      const { attempts, backoff, worst } = hopWorstCase(hop)
      const recommendedTimeoutMs = Math.max(
        Math.ceil(hop.typicalMs * 1.5),
        Math.floor(perHopBudget / attempts),
      )
      const overBudgetShare = hop.timeoutMs * attempts > perHopBudget * 1.05
      const timeoutTooTightForDownstream = i < n - 1 && hop.timeoutMs <= worstBelow[i]

      if (timeoutTooTightForDownstream) {
        warnings.push(
          `"${hop.name}" timeout ${hop.timeoutMs} ms is not larger than the worst case of everything it calls (${Math.round(worstBelow[i])} ms) — it will cut off a downstream call that could still have succeeded.`,
        )
      }
      if (overBudgetShare) {
        warnings.push(
          `"${hop.name}" with ${attempts} attempts × ${hop.timeoutMs} ms can use ${hop.timeoutMs * attempts} ms — more than its ${Math.round(perHopBudget)} ms share of the budget.`,
        )
      }

      return {
        name: hop.name,
        attempts,
        totalBackoffMs: backoff,
        worstCaseMs: worst,
        recommendedTimeoutMs,
        overBudgetShare,
        timeoutTooTightForDownstream,
      }
    })

    const worstCaseTotalMs = hops.reduce((acc, h) => acc + h.worstCaseMs, 0)
    const fitsBudget = worstCaseTotalMs <= input.endToEndBudgetMs
    const retryAmplification = input.hops.reduce((acc, h) => acc * (1 + Math.max(0, h.retries)), 1)
    const amplificationRisk = retryAmplification > 4

    if (!fitsBudget) {
      warnings.push(
        `Worst-case latency ${Math.round(worstCaseTotalMs)} ms exceeds the ${input.endToEndBudgetMs} ms budget by ${Math.round(worstCaseTotalMs - input.endToEndBudgetMs)} ms.`,
      )
    }
    if (amplificationRisk) {
      warnings.push(
        `Retry amplification ${retryAmplification}× — one user request can become up to ${retryAmplification} calls to the innermost hop. Retry at ONE layer, or use a retry budget / circuit breaker.`,
      )
    }

    return {
      hops,
      worstCaseTotalMs,
      fitsBudget,
      retryAmplification,
      amplificationRisk,
      warnings,
      summaryText: renderSummary(input, hops, worstCaseTotalMs, fitsBudget, retryAmplification),
    }
  }
}

function renderSummary(
  input: RetryBudgetInput,
  hops: RetryHopResult[],
  worst: number,
  fits: boolean,
  amp: number,
): string {
  const lines = [
    `Budget: ${input.endToEndBudgetMs} ms   Worst case: ${Math.round(worst)} ms   ${fits ? 'FITS' : 'OVER BUDGET'}`,
    `Retry amplification: ${amp}× to the innermost hop`,
    '',
    'Per hop (worst case → recommended timeout):',
  ]
  hops.forEach((h) => {
    lines.push(
      `  ${h.name}: ${h.attempts} attempt(s), worst ${Math.round(h.worstCaseMs)} ms → timeout ${h.recommendedTimeoutMs} ms` +
        (h.timeoutTooTightForDownstream ? '  ⚠ shorter than downstream worst case' : ''),
    )
  })
  lines.push('', 'Jitter helps the average, not the worst case shown here.')
  return lines.join('\n')
}
