/**
 * Optional dep-free crash reporting (OBSERVABILITY_PLAN O3). When
 * `VITE_ERROR_WEBHOOK` is set at build time, every surfaced error is POSTed
 * as JSON to that URL (a Slack incoming webhook, or any collector).
 * Rate-limited, best-effort, fire-and-forget. Off by default.
 */
import type { AppError } from '@/core/errors/appError'

const URL_ = (import.meta.env.VITE_ERROR_WEBHOOK as string | undefined) ?? ''
let lastSent = 0

export function sendErrorReport(err: AppError): void {
  if (!URL_) return
  const now = Date.now()
  if (now - lastSent < 1000) return // ≤1/s
  lastSent = now

  const payload = {
    ts: new Date().toISOString(),
    where: 'frontend',
    title: err.title,
    code: err.code,
    source: err.source ?? 'unknown',
    message: err.detail ?? '',
    url: typeof location !== 'undefined' ? location.pathname : '',
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  }
  try {
    void fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}
