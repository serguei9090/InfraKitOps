/**
 * Shared error model — every module classifies backend / transport failures
 * through `classify()` so they present consistently. Framework-free (no React),
 * same rule as the rest of `src/core/**`. See ERROR_HANDLING_PLAN.md §5.1.
 */
import { ERROR_STRINGS, RETRYABLE_CODES, STICKY_CODES } from './errorStrings'

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

// E3d — the strings live in errorStrings.ts (one file for a future i18n layer);
// this composes them with the retryable / sticky behaviour.
const PRESETS: Record<ErrorCode, Preset> = Object.fromEntries(
  (Object.keys(ERROR_STRINGS) as ErrorCode[]).map((code) => [
    code,
    {
      ...ERROR_STRINGS[code],
      retryable: RETRYABLE_CODES.has(code),
      sticky: STICKY_CODES.has(code),
    },
  ]),
) as Record<ErrorCode, Preset>

/** Toasts of these codes stay until the user dismisses them. */
export function isSticky(code: ErrorCode): boolean {
  return STICKY_CODES.has(code)
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
