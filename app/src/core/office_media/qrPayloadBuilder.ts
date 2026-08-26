import type { IToolUseCase } from '../ports/IToolUseCase'

/** Wi-Fi network security modes a QR "network config" payload can advertise. */
export type WifiSecurityType = 'wpa' | 'wep' | 'nopass'

/** Arbitrary text or URL — the payload is the text itself, unchanged. */
export interface PlainTextQrInput {
  kind: 'plainText'
  text: string
}

/**
 * A Wi-Fi network to encode using the widely-supported
 * `WIFI:T:...;S:...;P:...;H:...;;` payload format that Android/iOS camera
 * apps recognize and offer to auto-join.
 */
export interface WifiNetworkQrInput {
  kind: 'wifiNetwork'
  ssid: string
  password?: string
  /** @default 'wpa' */
  security?: WifiSecurityType
  /** @default false */
  hidden?: boolean
}

/**
 * A phone number to encode as an RFC 3966 `tel:` URI, so scanning offers to
 * place a call.
 */
export interface PhoneNumberQrInput {
  kind: 'phoneNumber'
  /** Free-form as typed; visual separators are stripped during build. */
  number: string
}

/**
 * A pre-composed SMS, encoded as `SMSTO:<number>:<message>` — the de-facto
 * form ZXing and virtually every phone camera app understands.
 */
export interface SmsQrInput {
  kind: 'sms'
  number: string
  message?: string
}

/**
 * A pre-composed email, encoded as an RFC 6068 `mailto:` URI with optional
 * percent-encoded `subject` / `body` query parameters.
 */
export interface EmailQrInput {
  kind: 'email'
  address: string
  subject?: string
  body?: string
}

/**
 * A contact card, encoded as a vCard 3.0 (RFC 2426) `BEGIN:VCARD` record.
 *
 * vCard 3.0 rather than 4.0 because iOS Camera, Google Lens and the Android
 * stock scanners all import 3.0 reliably, whereas 4.0 support is patchy.
 */
export interface VCardQrInput {
  kind: 'vCard'
  firstName?: string
  lastName?: string
  organization?: string
  title?: string
  phone?: string
  email?: string
  url?: string
  street?: string
  city?: string
  region?: string
  postalCode?: string
  country?: string
}

/** A map coordinate, encoded as an RFC 5870 `geo:` URI. */
export interface GeoLocationQrInput {
  kind: 'geoLocation'
  /** Decimal degrees, -90..90. */
  latitude: number
  /** Decimal degrees, -180..180. */
  longitude: number
  /** Optional third coordinate component, in meters. */
  altitudeMeters?: number
}

/**
 * A calendar entry, encoded as a bare iCalendar `BEGIN:VEVENT` block — the
 * shape ZXing's `VEventResultParser` (and therefore most scanners) expects
 * inside a QR code.
 */
export interface CalendarEventQrInput {
  kind: 'calendarEvent'
  summary: string
  start: Date
  end: Date
  location?: string
  description?: string
}

/** Union of the payload shapes {@link QrPayloadBuilder} knows how to build. */
export type QrPayloadInput =
  | PlainTextQrInput
  | WifiNetworkQrInput
  | PhoneNumberQrInput
  | SmsQrInput
  | EmailQrInput
  | VCardQrInput
  | GeoLocationQrInput
  | CalendarEventQrInput

/** vCard and iCalendar both mandate CRLF line breaks (RFC 2426 §2.1, RFC 5545 §3.1). */
const CRLF = '\r\n'

/**
 * Strips the RFC 3966 "visual separators" (spaces, dashes, dots,
 * parentheses) that scanners choke on, keeping a leading `+` and digits.
 *
 * Throws if nothing dialable remains.
 */
export function normalizePhoneNumber(raw: string): string {
  const trimmed = raw.trim()
  const isInternational = trimmed.startsWith('+')
  const digits = trimmed.replace(/[^0-9]/g, '')
  if (digits.length === 0) {
    throw new Error('Enter a phone number (digits only, optional +).')
  }
  return isInternational ? `+${digits}` : digits
}

/**
 * Deliberately permissive but structural: exactly one `@`, no whitespace or
 * URI delimiters, and a dotted domain.
 */
const EMAIL_PATTERN = /^[^\s@,;:<>"]+@[^\s@,;:<>"]+\.[^\s@,;:<>"]+$/

export function isValidEmail(address: string): boolean {
  return EMAIL_PATTERN.test(address.trim())
}

/** RFC 5545 UTC `DATE-TIME` form: `YYYYMMDDTHHMMSSZ`. */
export function formatICalUtc(value: Date): string {
  const two = (v: number) => v.toString().padStart(2, '0')
  const year = value.getUTCFullYear().toString().padStart(4, '0')
  return (
    `${year}${two(value.getUTCMonth() + 1)}${two(value.getUTCDate())}` +
    `T${two(value.getUTCHours())}${two(value.getUTCMinutes())}${two(value.getUTCSeconds())}Z`
  )
}

/**
 * Escapes the characters the `WIFI:` payload format treats as field
 * delimiters/quoting: `\`, `;`, `,` and `"`. Backslash is escaped first so
 * escaping the other characters afterwards doesn't double-escape it.
 */
function escapeWifi(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/"/g, '\\"')
}

/**
 * Shared backslash-escaping used by both vCard 3.0 (RFC 2426 §2) and
 * iCalendar (RFC 5545 §3.3.11): `\` -> `\\`, `;` -> `\;`, `,` -> `\,`, and any
 * line break -> the literal two-character sequence `\n`.
 *
 * Colons are intentionally *not* escaped: RFC 2426's own text grammar admits
 * a bare `:` and every real-world generator/parser (and `URL:` values such as
 * `https://...`) depends on that.
 */
function escapeStructuredText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n')
}

/** Fixed-notation decimal (never `1e-7`), with trailing zeros trimmed — RFC 5870 `num` doesn't permit exponents. */
function formatCoordinate(value: number): string {
  let text = value.toFixed(6)
  if (text.includes('.')) {
    text = text.replace(/0+$/, '')
    text = text.replace(/\.$/, '')
  }
  return text === '-0' ? '0' : text
}

function securityCode(security: WifiSecurityType): string {
  switch (security) {
    case 'wpa':
      return 'WPA'
    case 'wep':
      return 'WEP'
    case 'nopass':
      return 'nopass'
  }
}

function buildWifiPayload(input: WifiNetworkQrInput): string {
  if (input.ssid.length === 0) {
    throw new Error('ssid must not be empty')
  }

  const security = input.security ?? 'wpa'
  const hidden = input.hidden ?? false

  let payload = 'WIFI:'
  payload += `T:${securityCode(security)};`
  payload += `S:${escapeWifi(input.ssid)};`
  if (security !== 'nopass') {
    payload += `P:${escapeWifi(input.password ?? '')};`
  }
  payload += `H:${hidden};`
  payload += ';' // terminates the whole record, per the WIFI: spec

  return payload
}

function buildTelPayload(input: PhoneNumberQrInput): string {
  return `tel:${normalizePhoneNumber(input.number)}`
}

function buildSmsPayload(input: SmsQrInput): string {
  const number = normalizePhoneNumber(input.number)
  // `SMSTO:` has no escaping convention; parsers split on the first two
  // colons only, so a message may contain colons freely. Embedded line
  // breaks *would* corrupt the record, so they are folded to spaces.
  const message = (input.message ?? '').replace(/[\r\n]+/g, ' ')
  return `SMSTO:${number}:${message}`
}

function buildMailtoPayload(input: EmailQrInput): string {
  const address = input.address.trim()
  if (address.length === 0) {
    throw new Error('Enter an email address.')
  }
  if (!isValidEmail(address)) {
    throw new Error(`"${address}" is not a valid email address.`)
  }

  // RFC 6068 allows the addr-spec to appear literally; only the hfields need
  // percent-encoding. encodeURIComponent escapes space as %20 (not `+`),
  // which is what RFC 6068 requires, and escapes `&`, `?`, `=`, `#` and `+`
  // so they can't be mistaken for query syntax.
  const params: string[] = []
  if (input.subject && input.subject.length > 0) params.push(`subject=${encodeURIComponent(input.subject)}`)
  if (input.body && input.body.length > 0) params.push(`body=${encodeURIComponent(input.body)}`)

  return params.length === 0 ? `mailto:${address}` : `mailto:${address}?${params.join('&')}`
}

function validatedVCardEmail(email: string): string {
  const address = email.trim()
  if (!isValidEmail(address)) {
    throw new Error(`"${address}" is not a valid email address.`)
  }
  return address
}

function vCardHasAddress(input: VCardQrInput): boolean {
  return Boolean(
    (input.street && input.street.length > 0) ||
      (input.city && input.city.length > 0) ||
      (input.region && input.region.length > 0) ||
      (input.postalCode && input.postalCode.length > 0) ||
      (input.country && input.country.length > 0),
  )
}

function vCardAdrLine(input: VCardQrInput): string {
  // ADR structured value:
  // PO Box;Extended;Street;Locality;Region;Postal Code;Country
  const components = [
    '', // PO box — not collected
    '', // extended address — not collected
    (input.street ?? '').trim(),
    (input.city ?? '').trim(),
    (input.region ?? '').trim(),
    (input.postalCode ?? '').trim(),
    (input.country ?? '').trim(),
  ]
    .map(escapeStructuredText)
    .join(';')
  return `ADR;TYPE=HOME:${components}`
}

function buildVCardPayload(input: VCardQrInput): string {
  const first = (input.firstName ?? '').trim()
  const last = (input.lastName ?? '').trim()
  if (first.length === 0 && last.length === 0) {
    throw new Error('Enter at least a first or last name.')
  }

  const lines: string[] = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    // N is a structured value: Family;Given;Additional;Prefix;Suffix.
    // Every component is escaped independently so a comma or semicolon
    // inside one can't be read as a delimiter.
    `N:${escapeStructuredText(last)};${escapeStructuredText(first)};;;`,
    `FN:${escapeStructuredText([first, last].filter((p) => p.length > 0).join(' '))}`,
  ]
  if (input.organization && input.organization.trim().length > 0) {
    lines.push(`ORG:${escapeStructuredText(input.organization.trim())}`)
  }
  if (input.title && input.title.trim().length > 0) {
    lines.push(`TITLE:${escapeStructuredText(input.title.trim())}`)
  }
  if (input.phone && input.phone.trim().length > 0) {
    lines.push(`TEL;TYPE=CELL,VOICE:${normalizePhoneNumber(input.phone)}`)
  }
  if (input.email && input.email.trim().length > 0) {
    lines.push(`EMAIL;TYPE=INTERNET:${validatedVCardEmail(input.email)}`)
  }
  if (input.url && input.url.trim().length > 0) {
    lines.push(`URL:${escapeStructuredText(input.url.trim())}`)
  }
  if (vCardHasAddress(input)) {
    lines.push(vCardAdrLine(input))
  }
  lines.push('END:VCARD')

  return lines.join(CRLF)
}

function buildGeoPayload(input: GeoLocationQrInput): string {
  const lat = input.latitude
  const lon = input.longitude
  if (Number.isNaN(lat) || lat < -90 || lat > 90) {
    throw new Error('Latitude must be between -90 and 90.')
  }
  if (Number.isNaN(lon) || lon < -180 || lon > 180) {
    throw new Error('Longitude must be between -180 and 180.')
  }

  let payload = `geo:${formatCoordinate(lat)},${formatCoordinate(lon)}`

  const alt = input.altitudeMeters
  if (alt !== undefined) {
    if (Number.isNaN(alt) || !Number.isFinite(alt)) {
      throw new Error('Altitude must be a number.')
    }
    payload += `,${formatCoordinate(alt)}`
  }

  return payload
}

function buildVEventPayload(input: CalendarEventQrInput): string {
  const summary = input.summary.trim()
  if (summary.length === 0) {
    throw new Error('Enter an event title.')
  }
  if (input.end.getTime() < input.start.getTime()) {
    throw new Error('The event end must not be before its start.')
  }

  const lines: string[] = ['BEGIN:VEVENT', `SUMMARY:${escapeStructuredText(summary)}`]
  if (input.location && input.location.trim().length > 0) {
    lines.push(`LOCATION:${escapeStructuredText(input.location.trim())}`)
  }
  if (input.description && input.description.trim().length > 0) {
    lines.push(`DESCRIPTION:${escapeStructuredText(input.description.trim())}`)
  }
  lines.push(`DTSTART:${formatICalUtc(input.start)}`)
  lines.push(`DTEND:${formatICalUtc(input.end)}`)
  lines.push('END:VEVENT')

  return lines.join(CRLF)
}

/**
 * Builds the correctly-formatted string payloads QR codes commonly encode.
 *
 * This is deliberately just the *payload construction* — turning structured
 * input (a Wi-Fi network, a contact, some text) into the exact string a
 * QR-rendering call should encode. The actual QR matrix rendering happens in
 * the adapter layer via the `qrcode` npm package.
 */
export class QrPayloadBuilder implements IToolUseCase<QrPayloadInput, string> {
  execute(input: QrPayloadInput): string {
    switch (input.kind) {
      case 'plainText':
        return input.text
      case 'wifiNetwork':
        return buildWifiPayload(input)
      case 'phoneNumber':
        return buildTelPayload(input)
      case 'sms':
        return buildSmsPayload(input)
      case 'email':
        return buildMailtoPayload(input)
      case 'vCard':
        return buildVCardPayload(input)
      case 'geoLocation':
        return buildGeoPayload(input)
      case 'calendarEvent':
        return buildVEventPayload(input)
    }
  }
}
