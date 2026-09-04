/**
 * E3d — every user-facing error string in one place. `appError.ts` reads the
 * pieces to build its presets. Voice: title is a short noun/verb phrase, hint
 * is one imperative sentence saying what to do. No jargon, no stack traces.
 *
 * The app ships English only. If i18n is ever added it's a separate,
 * multi-week effort (a `t()` layer + threading it through the 44 tools) —
 * this file being the single home for error copy is the one piece already in
 * place. See POLISH_PLAN.md PL5.
 */
import type { ErrorCode } from './appError'

export interface ErrorStrings {
  title: string
  hint?: string
}

export const ERROR_STRINGS: Record<ErrorCode, ErrorStrings> = {
  auth_failed: {
    title: 'Authentication failed',
    hint: 'Check the API key or token for this connection.',
  },
  unreachable: {
    title: 'Service not reachable',
    hint: "The endpoint isn't answering. Check that it's running and the URL is right.",
  },
  timeout: {
    title: 'Request timed out',
    hint: 'The service took too long. Try again, or raise the timeout.',
  },
  rate_limited: {
    title: 'Rate limited',
    hint: 'The provider is throttling requests. Wait a moment, then retry.',
  },
  not_found: {
    title: 'Not found',
    hint: "The item may have been deleted or renamed. Refresh and try again.",
  },
  conflict: {
    title: 'Out of sync',
    hint: 'Something changed underneath. Reload, then try again.',
  },
  validation: {
    title: 'Request rejected',
    hint: 'One of the values is off — check the fields and try again.',
  },
  locked: {
    title: 'Vault is locked',
    hint: 'Unlock the Vault, then try again.',
  },
  permission: {
    title: 'Not permitted',
    hint: "You don't have the rights for this. It may need administrator access.",
  },
  upstream: {
    title: 'The provider rejected the request',
    hint: "The upstream service returned an error. It's not something you did.",
  },
  internal: {
    title: 'Backend error',
    hint: 'Something went wrong on the backend. Check its log for details.',
  },
  backend_down: {
    title: 'Backend not connected',
    hint: 'Start or configure the backend service in Settings → Backend.',
  },
  aborted: {
    title: 'Cancelled',
  },
  unknown: {
    title: 'Something went wrong',
    hint: 'Try again. If it keeps happening, check the error history.',
  },
}

/** Codes whose toast stays until dismissed. */
export const STICKY_CODES: ReadonlySet<ErrorCode> = new Set(['auth_failed', 'internal', 'backend_down'])

/** Codes worth offering a Retry for. */
export const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set([
  'unreachable',
  'timeout',
  'rate_limited',
  'conflict',
  'backend_down',
  'unknown',
])
