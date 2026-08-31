/**
 * Shared error model — every module classifies backend / transport failures
 * through `classify()` so they present consistently. Framework-free (no React),
 * same rule as the rest of `src/core/**`. See ERROR_HANDLING_PLAN.md §5.1.
 */

export type ErrorCode =
  | 'auth_failed'
  | 'unreachable'
  | 'timeout'
  | 'rate_limited'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'locked'
  | 'permission'
  | 'upstream'
  | 'internal'
  | 'backend_down'
  | 'aborted'
  | 'unknown'

export interface AppError {
  code: ErrorCode
  /** short, human — e.g. "Authentication failed" */
  title: string
  /** the raw backend / transport message */
  detail: string
  /** what to do about it */
  hint?: string
  retryable: boolean
  /** which module raised it — e.g. "AI Hub" */
  source?: string
}

/**
 * The concrete value `classify()` returns. It is also an `Error` (message =
 * detail) so existing `e instanceof Error ? e.message : …` call sites keep
 * working until they move to `report()`.
 */
export class AppErr extends Error implements AppError {
  code: ErrorCode
  title: string
  detail: string
  hint?: string
  retryable: boolean
  source?: string

  constructor(f: AppError) {
    super(f.detail || f.title)
    this.name = 'AppErr'
    this.code = f.code
    this.title = f.title
    this.detail = f.detail
    this.hint = f.hint
    this.retryable = f.retryable
    this.source = f.source
  }
}

interface Preset {
  title: string
  hint?: string
  retryable: boolean
  /** stays until dismissed rather than auto-dismissing */
  sticky?: boolean
}

const PRESETS: Record<ErrorCode, Preset> = {
  auth_failed: { title: 'Authentication failed', hint: 'Check the API key or token for this connection.', retryable: false, sticky: true },
  unreachable: { title: 'Service not reachable', hint: "The endpoint isn't answering. Is it running, and is the URL right?", retryable: true },
  timeout: { title: 'Request timed out', hint: 'The service took too long. Try again, or raise the timeout.', retryable: true },
  rate_limited: { title: 'Rate limited', hint: 'The provider is throttling requests. Wait a moment and retry.', retryable: true },
  not_found: { title: 'Not found', retryable: false },
  conflict: { title: 'Conflict', hint: 'Something changed underneath — reload and try again.', retryable: true },
  validation: { title: "Can't do that", retryable: false },
  locked: { title: 'Vault is locked', hint: 'Unlock the Vault, then try again.', retryable: false },
  permission: { title: 'Not permitted', retryable: false },
  upstream: { title: 'The provider rejected the request', retryable: false },
  internal: { title: 'Backend error', hint: 'Something went wrong on the backend. Check its log.', retryable: false, sticky: true },
  backend_down: { title: 'Backend not connected', hint: 'Configure or start the backend service (Settings → Backend).', retryable: true, sticky: true },
  aborted: { title: 'Cancelled', retryable: false },
  unknown: { title: 'Something went wrong', retryable: true },
}

/** Toasts of these codes stay until the user dismisses them. */
export function isSticky(code: ErrorCode): boolean {
  return PRESETS[code]?.sticky ?? false
}

/** True for a user/programmatic cancellation that should never be surfaced. */
export function isAborted(raw: unknown): boolean {
  if (raw instanceof DOMException && raw.name === 'AbortError') return true
  if (raw instanceof Error && (raw.name === 'AbortError' || raw.message === 'The operation was aborted.')) return true
  if (isAppError(raw) && raw.code === 'aborted') return true
  return false
}

export function isAppError(raw: unknown): raw is AppError {
  return (
    raw instanceof AppErr ||
    (typeof raw === 'object' &&
      raw !== null &&
      'code' in raw &&
      'title' in raw &&
      'detail' in raw &&
      typeof (raw as AppError).code === 'string')
  )
}

/** Backend error envelope: `{ error, code?, hint? }`. */
interface Envelope {
  error?: string
  code?: string
  hint?: string
}
function isEnvelope(raw: unknown): raw is Envelope {
  return typeof raw === 'object' && raw !== null && ('error' in raw || 'code' in raw)
}

const KNOWN_CODES = new Set<string>(Object.keys(PRESETS))

function build(code: ErrorCode, detail: string, opts?: { hint?: string; source?: string }): AppErr {
  const p = PRESETS[code]
  return new AppErr({
    code,
    title: p.title,
    detail: detail || p.title,
    hint: opts?.hint ?? p.hint,
    retryable: p.retryable,
    source: opts?.source,
  })
}

/**
 * Normalise anything thrown / received into an `AppError`.
 * Handles: an existing AppError · `BackendUnavailableError` · AbortError ·
 * `TypeError` "Failed to fetch" · a parsed backend envelope · a plain `Error`
 * · a string.
 */
export function classify(raw: unknown, source?: string): AppErr {
  if (raw instanceof AppErr) {
    if (!raw.source && source) raw.source = source
    return raw
  }
  if (isAppError(raw)) {
    return new AppErr({ ...raw, source: raw.source ?? source })
  }

  if (isAborted(raw)) return build('aborted', 'aborted', { source })

  // BackendUnavailableError (adapters/backend) — matched by name to avoid a
  // core → adapter import.
  if (raw instanceof Error && raw.name === 'BackendUnavailableError') {
    return build('backend_down', raw.message || 'no backend', { source })
  }

  if (raw instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(raw.message)) {
    return build('unreachable', raw.message, { source })
  }

  if (isEnvelope(raw)) {
    const code = raw.code && KNOWN_CODES.has(raw.code) ? (raw.code as ErrorCode) : 'unknown'
    return build(code, raw.error ?? '', { hint: raw.hint, source })
  }

  if (raw instanceof Error) return build('unknown', raw.message, { source })
  if (typeof raw === 'string') return build('unknown', raw, { source })

  return build('unknown', 'Unexpected error', { source })
}
