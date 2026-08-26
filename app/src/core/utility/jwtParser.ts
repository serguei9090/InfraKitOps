import type { IToolUseCase } from '../ports/IToolUseCase'

/** Where a token sits relative to its `nbf`/`exp` claims *right now*. */
export type JwtTemporalStatus = 'valid' | 'expired' | 'notYetValid'

/**
 * One registered ("reserved") claim from RFC 7519 section 4.1, paired with
 * the human-readable meaning most people open a JWT debugger to look up.
 */
export interface JwtRegisteredClaim {
  /** The claim key as it appears in the payload, e.g. `exp`. */
  name: string
  /** Short human name, e.g. "Expires at". */
  label: string
  /** One-line explanation of what the claim is for. */
  meaning: string
  /** The value exactly as decoded from JSON. */
  rawValue: unknown
  /**
   * Presentation string — for NumericDate claims this is the ISO-8601 UTC
   * timestamp rather than the raw epoch seconds.
   */
  displayValue: string
  /**
   * Non-undefined only for the NumericDate claims (`exp`, `nbf`, `iat`), and
   * only when the raw value was actually numeric. Always UTC.
   */
  dateTime?: Date
}

export interface JwtParseInput {
  /**
   * The raw compact-serialization token, e.g. `eyJ...` — surrounding
   * whitespace and a leading `Bearer ` prefix are tolerated.
   */
  token: string
  /**
   * Reference instant for expiry math. Defaults to `new Date()` at parse
   * time; tests inject a fixed value.
   */
  now?: Date
}

/**
 * The outcome of decoding a token. Either `isValidStructure` is true and the
 * decoded fields are populated, or `errorMessage` explains what was wrong —
 * `JwtParser` never throws.
 */
export interface JwtParseResult {
  isValidStructure: boolean
  /** Undefined when `isValidStructure` is true. */
  errorMessage?: string

  header: Record<string, unknown>
  payload: Record<string, unknown>

  /** Pretty-printed (2-space indented) JSON for display in a monospace panel. */
  headerJson: string
  payloadJson: string

  /** The third segment, still base64url-encoded. Empty for unsecured JWTs. */
  signatureBase64Url: string

  /** The `alg` header value, e.g. `HS256`. Undefined when the header omits it. */
  algorithm?: string
  /** The `typ` header value, e.g. `JWT`. */
  tokenType?: string
  /** The `kid` header value — which key the issuer says signed this. */
  keyId?: string

  /**
   * True when `alg` is `none` (case-insensitive) or the signature segment is
   * empty. This is the classic JWT vulnerability (CVE-2015-9235 family): a
   * server that honours the token's own `alg` will accept an attacker-forged
   * token with the signature stripped. Surface it loudly.
   */
  isUnsignedAlgorithm: boolean

  /**
   * The RFC 7519 registered claims that were actually present, in the
   * canonical order iss, sub, aud, exp, nbf, iat, jti.
   */
  registeredClaims: JwtRegisteredClaim[]

  temporalStatus: JwtTemporalStatus

  /** UTC instants from `exp` / `nbf` / `iat`, or undefined when absent/non-numeric. */
  expiresAt?: Date
  notBefore?: Date
  issuedAt?: Date

  /**
   * Milliseconds remaining until expiry: positive while the token is still
   * good, negative once it has expired. Undefined when there is no usable
   * `exp`. (Represents Dart's `Duration` as milliseconds — the smallest unit
   * JS's `Date` resolves to.)
   */
  timeUntilExpiryMs?: number

  /** Milliseconds until `nbf` becomes valid. Undefined otherwise. */
  timeUntilValidMs?: number

  /**
   * How many dot-separated segments the input had (2 is a valid unsecured
   * JWT with the trailing dot omitted; 3 is normal).
   */
  segmentCount: number
}

export function isExpired(result: JwtParseResult): boolean {
  return result.temporalStatus === 'expired'
}

export function isNotYetValid(result: JwtParseResult): boolean {
  return result.temporalStatus === 'notYetValid'
}

/**
 * Always false. This tool decodes; it does not verify. Kept as an explicit
 * field (rather than left implicit) so that any UI binding to a result
 * cannot accidentally imply the signature checked out.
 */
export function signatureVerified(_result: JwtParseResult): boolean {
  return false
}

/** The disclaimer the UI must display verbatim alongside any decoded token. */
export const JWT_SIGNATURE_NOTICE =
  'Signature NOT verified. This tool only decodes the token — no key was ' +
  'supplied and no cryptographic check was performed. A token shown here ' +
  'may be forged, tampered with, or signed by an untrusted key.'

function failure(message: string, segmentCount = 0): JwtParseResult {
  return {
    isValidStructure: false,
    errorMessage: message,
    header: {},
    payload: {},
    headerJson: '',
    payloadJson: '',
    signatureBase64Url: '',
    algorithm: undefined,
    tokenType: undefined,
    keyId: undefined,
    isUnsignedAlgorithm: false,
    registeredClaims: [],
    temporalStatus: 'valid',
    expiresAt: undefined,
    notBefore: undefined,
    issuedAt: undefined,
    timeUntilExpiryMs: undefined,
    timeUntilValidMs: undefined,
    segmentCount,
  }
}

/** Registered claim metadata, in RFC 7519 section 4.1 order. */
const REGISTERED_CLAIM_SPECS: { name: string; label: string; meaning: string }[] = [
  { name: 'iss', label: 'Issuer', meaning: 'Who created and signed this token.' },
  { name: 'sub', label: 'Subject', meaning: 'Who or what the token is about — usually the user id.' },
  { name: 'aud', label: 'Audience', meaning: 'Who the token is intended for; recipients must reject others.' },
  { name: 'exp', label: 'Expires at', meaning: 'Do not accept the token at or after this time.' },
  { name: 'nbf', label: 'Not before', meaning: 'Do not accept the token before this time.' },
  { name: 'iat', label: 'Issued at', meaning: 'When the token was created; used to judge token age.' },
  { name: 'jti', label: 'JWT ID', meaning: 'Unique token identifier, used to prevent replay.' },
]

/**
 * Decodes a JSON Web Token (JWS Compact Serialization, RFC 7515/7519) into
 * its header, payload and signature parts, surfaces the registered claims
 * with human-readable meanings, and reports whether the token is currently
 * expired or not yet valid.
 *
 * ## This decodes; it does NOT verify
 *
 * No signing key is accepted and no signature check is performed. A result
 * from this class says nothing whatsoever about a token's authenticity — the
 * payload is attacker-controlled data until something with the key says
 * otherwise. Every result carries `JWT_SIGNATURE_NOTICE` and
 * `signatureVerified()` is hard-wired to `false` so that no UI can imply
 * validation happened. Never use this to make an auth decision.
 *
 * Browser-safe: uses `atob`/`TextDecoder`, no Node `Buffer`. Malformed input
 * returns a failure result; nothing throws.
 */
export class JwtParser implements IToolUseCase<JwtParseInput, JwtParseResult> {
  execute(input: JwtParseInput): JwtParseResult {
    const now = input.now ?? new Date()

    let token = input.token.trim()
    if (token.length === 0) {
      return failure('Enter a JWT to decode.')
    }
    // Tolerate a pasted Authorization header.
    if (token.length > 7 && token.substring(0, 7).toLowerCase() === 'bearer ') {
      token = token.substring(7).trim()
    }
    // Tolerate line wrapping from a terminal copy/paste.
    token = token.replace(/\s+/g, '')

    const segments = token.split('.')
    if (segments.length < 2 || segments.length > 3) {
      return failure(
        'A JWT has 3 dot-separated segments (header.payload.signature); ' +
          `this input has ${segments.length}.`,
        segments.length,
      )
    }
    if (segments[0].length === 0 || segments[1].length === 0) {
      return failure('The header and payload segments must not be empty.', segments.length)
    }

    let header: Record<string, unknown>
    try {
      header = decodeJsonSegment(segments[0], 'header')
    } catch (e) {
      return failure((e as Error).message, segments.length)
    }

    let payload: Record<string, unknown>
    try {
      payload = decodeJsonSegment(segments[1], 'payload')
    } catch (e) {
      return failure((e as Error).message, segments.length)
    }

    const signature = segments.length === 3 ? segments[2] : ''
    const algorithm = stringOrUndefined(header['alg'])
    const isUnsigned = (algorithm !== undefined && algorithm.toLowerCase() === 'none') || signature.length === 0

    const expiresAt = numericDate(payload['exp'])
    const notBefore = numericDate(payload['nbf'])
    const issuedAt = numericDate(payload['iat'])

    let status: JwtTemporalStatus = 'valid'
    let timeUntilExpiryMs: number | undefined
    let timeUntilValidMs: number | undefined

    if (expiresAt !== undefined) {
      timeUntilExpiryMs = expiresAt.getTime() - now.getTime()
      // `exp` is "MUST NOT be accepted on or after", so <= 0 means expired.
      if (timeUntilExpiryMs <= 0) status = 'expired'
    }
    if (notBefore !== undefined) {
      const delta = notBefore.getTime() - now.getTime()
      if (delta > 0) {
        timeUntilValidMs = delta
        // Expiry wins when a token is somehow both — it can never be used.
        if (status === 'valid') status = 'notYetValid'
      }
    }

    const claims: JwtRegisteredClaim[] = []
    for (const spec of REGISTERED_CLAIM_SPECS) {
      if (!(spec.name in payload)) continue
      const raw = payload[spec.name]
      const date = numericDate(raw)
      claims.push({
        name: spec.name,
        label: spec.label,
        meaning: spec.meaning,
        rawValue: raw,
        displayValue: date !== undefined ? formatUtc(date) : formatScalar(raw),
        dateTime: date,
      })
    }

    return {
      isValidStructure: true,
      errorMessage: undefined,
      header,
      payload,
      headerJson: JSON.stringify(header, null, 2),
      payloadJson: JSON.stringify(payload, null, 2),
      signatureBase64Url: signature,
      algorithm,
      tokenType: stringOrUndefined(header['typ']),
      keyId: stringOrUndefined(header['kid']),
      isUnsignedAlgorithm: isUnsigned,
      registeredClaims: claims,
      temporalStatus: status,
      expiresAt,
      notBefore,
      issuedAt,
      timeUntilExpiryMs,
      timeUntilValidMs,
      segmentCount: segments.length,
    }
  }
}

/**
 * base64url-decodes `segment` (JWTs strip the `=` padding, so it is restored
 * here) and parses the bytes as a UTF-8 JSON object.
 */
function decodeJsonSegment(segment: string, label: string): Record<string, unknown> {
  let bytes: Uint8Array
  try {
    bytes = decodeBase64UrlBytes(segment)
  } catch {
    throw new Error(`The ${label} segment is not valid base64url.`)
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`The ${label} segment did not decode to valid UTF-8 text.`)
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch {
    throw new Error(`The ${label} segment is not valid JSON.`)
  }

  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new Error(`The ${label} segment must be a JSON object.`)
  }
  return decoded as Record<string, unknown>
}

/**
 * base64url decode that tolerates the missing `=` padding JWTs always strip
 * (RFC 7515 appendix C). Throws on bad input. Returns raw bytes (not text —
 * callers decode as UTF-8 themselves).
 */
export function decodeBase64Url(input: string): Uint8Array {
  return decodeBase64UrlBytes(input)
}

function decodeBase64UrlBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const remainder = normalized.length % 4
  if (remainder === 1) {
    throw new Error('Invalid base64url length')
  }
  const padded = remainder === 0 ? normalized : normalized.padEnd(normalized.length + (4 - remainder), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** RFC 7519 NumericDate: seconds (possibly fractional) since the epoch, UTC. */
function numericDate(value: unknown): Date | undefined {
  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) return undefined
    return new Date(Math.round(value * 1000))
  }
  return undefined
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return value.map(formatScalar).join(', ')
  return String(value)
}

function formatUtc(value: Date): string {
  const iso = value.toISOString()
  // Drop the millisecond noise NumericDate never carries.
  return iso.endsWith('.000Z') ? `${iso.substring(0, iso.length - 5)}Z UTC` : `${iso} UTC`
}

/**
 * Renders a duration (in milliseconds) as "2d 3h" / "45s" style text for the
 * expiry countdown. Lives here (not in the UI) so it is unit-testable.
 */
export function formatJwtDuration(durationMs: number): string {
  const d = Math.abs(durationMs)
  const totalSeconds = Math.floor(d / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`

  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  const minutes = totalMinutes % 60

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`)
  if (parts.length === 0) parts.push(`${totalMinutes}m`)
  return parts.join(' ')
}
