import jsQR from 'jsqr'
import type { IToolUseCase } from '../ports/IToolUseCase'

/** Why a decode attempt ended the way it did. */
export type QrDecodeStatus = 'decoded' | 'notFound' | 'unreadableImage'

/** One label/value pair of a parsed structured payload, ready to render. */
export interface QrPayloadField {
  label: string
  value: string
}

/**
 * A recognized structured payload, parsed back into its parts.
 *
 * These mirror the payload formats `qrPayloadBuilder.ts` *writes*, so a code
 * this app generated round-trips into a readable breakdown instead of a raw
 * string. Anything unrecognized falls back to `{ kind: 'plainText' }`.
 */
export type DecodedQrPayload =
  | { kind: 'wifi'; ssid: string; security: string; password: string; hidden: boolean }
  | { kind: 'phone'; number: string }
  | { kind: 'sms'; number: string; message: string }
  | { kind: 'email'; address: string; subject: string; body: string }
  | {
      kind: 'vCard'
      fullName: string
      organization: string
      title: string
      phone: string
      email: string
      url: string
      /** The ADR components rejoined with commas, e.g. "1 Main St, Springfield". */
      address: string
    }
  | { kind: 'geo'; latitude: string; longitude: string; altitudeMeters: string | null }
  | {
      kind: 'calendarEvent'
      summary: string
      location: string
      description: string
      /** Raw `DTSTART` / `DTEND` values as written (e.g. `20260824T130000Z`). */
      start: string
      end: string
    }
  | { kind: 'url'; url: string }
  | { kind: 'plainText'; text: string }

/** Human-readable payload kind, e.g. "Wi-Fi network". */
export function payloadKindLabel(payload: DecodedQrPayload): string {
  switch (payload.kind) {
    case 'wifi':
      return 'Wi-Fi network'
    case 'phone':
      return 'Phone number'
    case 'sms':
      return 'SMS message'
    case 'email':
      return 'Email'
    case 'vCard':
      return 'Contact card (vCard)'
    case 'geo':
      return 'Map location'
    case 'calendarEvent':
      return 'Calendar event'
    case 'url':
      return 'Web link'
    case 'plainText':
      return 'Plain text'
  }
}

/** The parsed parts of a {@link DecodedQrPayload}, in display order. Empty values are omitted. */
export function payloadFields(payload: DecodedQrPayload): QrPayloadField[] {
  switch (payload.kind) {
    case 'wifi':
      return [
        { label: 'Network (SSID)', value: payload.ssid },
        { label: 'Security', value: payload.security.length === 0 ? 'unspecified' : payload.security },
        ...(payload.password.length > 0 ? [{ label: 'Password', value: payload.password }] : []),
        { label: 'Hidden network', value: payload.hidden ? 'yes' : 'no' },
      ]
    case 'phone':
      return [{ label: 'Number', value: payload.number }]
    case 'sms':
      return [
        { label: 'Number', value: payload.number },
        ...(payload.message.length > 0 ? [{ label: 'Message', value: payload.message }] : []),
      ]
    case 'email':
      return [
        { label: 'To', value: payload.address },
        ...(payload.subject.length > 0 ? [{ label: 'Subject', value: payload.subject }] : []),
        ...(payload.body.length > 0 ? [{ label: 'Body', value: payload.body }] : []),
      ]
    case 'vCard':
      return [
        ...(payload.fullName.length > 0 ? [{ label: 'Name', value: payload.fullName }] : []),
        ...(payload.organization.length > 0 ? [{ label: 'Organization', value: payload.organization }] : []),
        ...(payload.title.length > 0 ? [{ label: 'Title', value: payload.title }] : []),
        ...(payload.phone.length > 0 ? [{ label: 'Phone', value: payload.phone }] : []),
        ...(payload.email.length > 0 ? [{ label: 'Email', value: payload.email }] : []),
        ...(payload.url.length > 0 ? [{ label: 'Website', value: payload.url }] : []),
        ...(payload.address.length > 0 ? [{ label: 'Address', value: payload.address }] : []),
      ]
    case 'geo':
      return [
        { label: 'Latitude', value: payload.latitude },
        { label: 'Longitude', value: payload.longitude },
        ...(payload.altitudeMeters != null ? [{ label: 'Altitude (m)', value: payload.altitudeMeters }] : []),
      ]
    case 'calendarEvent':
      return [
        ...(payload.summary.length > 0 ? [{ label: 'Title', value: payload.summary }] : []),
        ...(payload.start.length > 0 ? [{ label: 'Starts', value: payload.start }] : []),
        ...(payload.end.length > 0 ? [{ label: 'Ends', value: payload.end }] : []),
        ...(payload.location.length > 0 ? [{ label: 'Location', value: payload.location }] : []),
        ...(payload.description.length > 0 ? [{ label: 'Description', value: payload.description }] : []),
      ]
    case 'url':
      return [{ label: 'URL', value: payload.url }]
    case 'plainText':
      return [{ label: 'Text', value: payload.text }]
  }
}

/** Outcome of one decode attempt. Never an exception for the ordinary "no QR code in this picture" case — check `status`. */
export interface QrDecodeResult {
  status: QrDecodeStatus
  /** The raw decoded payload string. Empty unless `status` is `'decoded'`. */
  text: string
  /** Barcode symbology reported by the reader — always `'QR Code'` here, since only the QR reader is run. */
  format?: string
  /** `L`, `M`, `Q` or `H`. jsQR does not expose the error correction level it decoded with, so this is always undefined. */
  errorCorrectionLevel?: string
  /** QR symbol version (1..40), as reported by jsQR. */
  symbolVersion?: number
  /** The structured breakdown of `text`, or undefined when nothing was decoded. */
  payload?: DecodedQrPayload
  /** Human-readable explanation for a non-`'decoded'` status. */
  message?: string
}

function notFoundResult(message?: string): QrDecodeResult {
  return { status: 'notFound', text: '', message: message ?? 'No QR code was found in this image.' }
}

function unreadableImageResult(message?: string): QrDecodeResult {
  return { status: 'unreadableImage', text: '', message: message ?? 'These bytes could not be decoded as an image.' }
}

export function isDecoded(result: QrDecodeResult): boolean {
  return result.status === 'decoded'
}

/** `QR Code` — a short display name for `result.format`. */
export function formatLabel(result: QrDecodeResult): string {
  return result.format === 'qrCode' ? 'QR Code' : (result.format ?? 'unknown')
}

// ------------------------------------------------------- payload parsing

/**
 * Splits on `delimiter` while honouring backslash escapes, so a `\;` inside
 * a Wi-Fi password or a vCard component is not a field break.
 */
function splitEscaped(value: string, delimiter: string): string[] {
  const parts: string[] = []
  let buffer = ''
  let escaped = false
  for (const ch of value) {
    if (escaped) {
      buffer += '\\' + ch
      escaped = false
    } else if (ch === '\\') {
      escaped = true
    } else if (ch === delimiter) {
      parts.push(buffer)
      buffer = ''
    } else {
      buffer += ch
    }
  }
  if (escaped) buffer += '\\'
  parts.push(buffer)
  return parts
}

function unescape(value: string, expandNewlines: boolean): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch !== '\\' || i + 1 >= value.length) {
      out += ch
      continue
    }
    const next = value[i + 1]
    i++
    if (expandNewlines && (next === 'n' || next === 'N')) {
      out += '\n'
    } else {
      out += next
    }
  }
  return out
}

/** Reverses the `WIFI:` payload escaping (`\\`, `\;`, `\,`, `\"`, `\:`). */
function unescapeWifi(value: string): string {
  return unescape(value, false)
}

/** Reverses vCard 3.0 / iCalendar TEXT escaping, including `\n`. */
function unescapeText(value: string): string {
  return unescape(value, true)
}

/** Percent-decoding that tolerates a stray `%` rather than throwing. */
function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseWifi(text: string): DecodedQrPayload {
  const body = text.slice(5)
  const fields = splitEscaped(body, ';')

  let ssid = ''
  let password = ''
  let security = ''
  let hidden = false

  for (const field of fields) {
    if (field.length === 0) continue
    const colon = field.indexOf(':')
    if (colon <= 0) continue
    const key = field.slice(0, colon).toUpperCase()
    const value = unescapeWifi(field.slice(colon + 1))
    switch (key) {
      case 'S':
        ssid = value
        break
      case 'P':
        password = value
        break
      case 'T':
        security = value
        break
      case 'H':
        hidden = value.toLowerCase() === 'true'
        break
    }
  }

  if (ssid.length === 0) return { kind: 'plainText', text }
  return { kind: 'wifi', ssid, security, password, hidden }
}

function parseSms(text: string): DecodedQrPayload {
  // SMSTO:<number>:<message> — the message may itself contain colons, so
  // only the first two are delimiters.
  const body = text.slice(6)
  const colon = body.indexOf(':')
  if (colon === -1) {
    return { kind: 'sms', number: body.trim(), message: '' }
  }
  return { kind: 'sms', number: body.slice(0, colon).trim(), message: body.slice(colon + 1) }
}

function parseMailto(text: string): DecodedQrPayload {
  const body = text.slice(7)
  const question = body.indexOf('?')
  const address = (question === -1 ? body : body.slice(0, question)).trim()
  if (address.length === 0) return { kind: 'plainText', text }

  let subject = ''
  let mailBody = ''
  if (question !== -1) {
    for (const pair of body.slice(question + 1).split('&')) {
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      const key = pair.slice(0, eq).toLowerCase()
      const value = decodeComponent(pair.slice(eq + 1))
      if (key === 'subject') subject = value
      if (key === 'body') mailBody = value
    }
  }
  return { kind: 'email', address, subject, body: mailBody }
}

function parseGeo(text: string): DecodedQrPayload {
  const parts = text.slice(4).split(';')[0].split(',')
  if (parts.length < 2) return { kind: 'plainText', text }
  const lat = parts[0].trim()
  const lon = parts[1].trim()
  if (Number.isNaN(Number(lat)) || lat === '' || Number.isNaN(Number(lon)) || lon === '') {
    return { kind: 'plainText', text }
  }
  const altRaw = parts.length > 2 ? parts[2].trim() : ''
  const altitudeMeters = altRaw !== '' && !Number.isNaN(Number(altRaw)) ? altRaw : null
  return { kind: 'geo', latitude: lat, longitude: lon, altitudeMeters }
}

/**
 * Parses vCard/iCalendar `NAME;PARAM=x:value` lines into a name -> value map,
 * dropping the parameters and unescaping the value. Later duplicates of a
 * name are ignored (first wins), matching how the builder emits at most one
 * of each.
 */
function icalProperties(text: string): Map<string, string> {
  const props = new Map<string, string>()
  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    let name = line.slice(0, colon)
    const semi = name.indexOf(';')
    if (semi !== -1) name = name.slice(0, semi)
    name = name.trim().toUpperCase()
    if (name === 'BEGIN' || name === 'END' || name === 'VERSION') continue

    const value = line.slice(colon + 1)
    if (!props.has(name)) {
      // ADR/N keep their raw semicolons — the caller splits them itself.
      props.set(name, name === 'ADR' || name === 'N' ? value : unescapeText(value))
    }
  }
  return props
}

function parseVCard(text: string): DecodedQrPayload {
  const props = icalProperties(text)

  let fullName = props.get('FN') ?? ''
  if (fullName.length === 0 && props.has('N')) {
    // N is Family;Given;Additional;Prefix;Suffix.
    const n = splitEscaped(props.get('N')!, ';')
    const family = n.length > 0 ? n[0] : ''
    const given = n.length > 1 ? n[1] : ''
    fullName = [given, family].filter((p) => p.trim().length > 0).join(' ').trim()
  }

  let address = ''
  if (props.has('ADR')) {
    // PO Box;Extended;Street;Locality;Region;Postal;Country
    address = splitEscaped(props.get('ADR')!, ';')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join(', ')
  }

  return {
    kind: 'vCard',
    fullName,
    organization: props.get('ORG') ?? '',
    title: props.get('TITLE') ?? '',
    phone: props.get('TEL') ?? '',
    email: props.get('EMAIL') ?? '',
    url: props.get('URL') ?? '',
    address,
  }
}

function parseVEvent(text: string): DecodedQrPayload {
  const props = icalProperties(text)
  return {
    kind: 'calendarEvent',
    summary: props.get('SUMMARY') ?? '',
    location: props.get('LOCATION') ?? '',
    description: props.get('DESCRIPTION') ?? '',
    start: props.get('DTSTART') ?? '',
    end: props.get('DTEND') ?? '',
  }
}

/**
 * Recognizes the structured payload formats this app generates and parses
 * `text` back into its parts. Never throws: an almost-but-not-quite payload
 * degrades to `{ kind: 'plainText' }` rather than failing.
 */
export function parsePayload(text: string): DecodedQrPayload {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { kind: 'plainText', text }

  const upper = trimmed.toUpperCase()
  try {
    if (upper.startsWith('WIFI:')) return parseWifi(trimmed)
    if (upper.startsWith('SMSTO:')) return parseSms(trimmed)
    if (upper.startsWith('TEL:')) return { kind: 'phone', number: trimmed.slice(4).trim() }
    if (upper.startsWith('MAILTO:')) return parseMailto(trimmed)
    if (upper.startsWith('BEGIN:VCARD')) return parseVCard(trimmed)
    if (upper.startsWith('BEGIN:VEVENT')) return parseVEvent(trimmed)
    if (upper.startsWith('GEO:')) return parseGeo(trimmed)
    if (upper.startsWith('HTTP://') || upper.startsWith('HTTPS://')) return { kind: 'url', url: trimmed }
  } catch {
    // A malformed structured payload is still perfectly good plain text.
    return { kind: 'plainText', text }
  }
  return { kind: 'plainText', text }
}

// ------------------------------------------------------------- image decode

/** Above this many pixels the source is downscaled before decoding. */
const MAX_PIXELS = 4_000_000

/**
 * Reads a QR code out of an image and, where possible, parses the payload
 * back into structured parts.
 *
 * This is the read half of the app's QR support: `qrPayloadBuilder.ts`
 * writes the payload strings and this decodes an image someone dropped in.
 * Decoding needs the browser's Canvas API (`createImageBitmap` +
 * `CanvasRenderingContext2D`), so unlike the rest of `src/core/**` this file
 * is async and depends on a browser runtime — the hex boundary this repo
 * enforces is "no React/UI imports", not "no browser Web APIs" (the same
 * reasoning already applies to `crypto.subtle` elsewhere in core).
 */
export class QrDecoder implements IToolUseCase<Uint8Array, QrDecodeResult> {
  async execute(input: Uint8Array): Promise<QrDecodeResult> {
    return this.decodeImageBytes(input)
  }

  /**
   * Decodes `bytes` (any format the browser's image decoder supports) and
   * returns the outcome. Does not throw for ordinary failures — inspect
   * `result.status`.
   */
  async decodeImageBytes(bytes: Uint8Array): Promise<QrDecodeResult> {
    if (bytes.byteLength === 0) {
      return unreadableImageResult('The file is empty.')
    }

    let bitmap: ImageBitmap
    try {
      // Slice to a fresh ArrayBuffer-backed Blob source; `bytes` may be a
      // view over a larger buffer (e.g. from `File.arrayBuffer()`).
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer])
      bitmap = await createImageBitmap(blob)
    } catch (e) {
      return unreadableImageResult(
        `This file could not be read as an image. PNG, JPEG, GIF, BMP and WebP are supported. (${
          e instanceof Error ? e.message : String(e)
        })`,
      )
    }

    try {
      let width = bitmap.width
      let height = bitmap.height

      const canvas = document.createElement('canvas')
      if (width * height > MAX_PIXELS) {
        // A 12-megapixel phone photo of a QR code decodes no better than a
        // 2 MP one and costs many seconds of pixel processing.
        const scale = Math.sqrt(MAX_PIXELS / (width * height))
        width = Math.max(1, Math.round(width * scale))
        height = Math.max(1, Math.round(height * scale))
      }
      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        return unreadableImageResult('This browser does not support 2D canvas rendering.')
      }
      // Compositing onto an opaque canvas matters: QR PNGs are routinely
      // exported with a transparent background, and a transparent pixel read
      // as black would smear the whole quiet zone into the symbol and make
      // detection fail.
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(bitmap, 0, 0, width, height)

      const imageData = ctx.getImageData(0, 0, width, height)
      return this.decodePixels(imageData.data, width, height)
    } finally {
      bitmap.close?.()
    }
  }

  /**
   * Runs the QR reader over already-decoded RGBA pixel data (e.g. from
   * `CanvasRenderingContext2D.getImageData`). Pure and Canvas-free, unlike
   * `decodeImageBytes` — split out the same way the Dart core split
   * `decodeImageBytes` from `decodePixels`, so this half can be unit tested
   * (and reused) without a browser `document`/`createImageBitmap`.
   */
  decodePixels(rgba: Uint8ClampedArray, width: number, height: number): QrDecodeResult {
    if (width < 8 || height < 8) {
      return notFoundResult('The image is too small to contain a QR code.')
    }

    // "attemptBoth" (jsQR's default) already tries the image both normal and
    // color-inverted in one call, so there is no separate "tryHarder" pass
    // the way the zxing2-based Dart reader had.
    const code = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' })
    if (!code) return notFoundResult()

    return {
      status: 'decoded',
      text: code.data,
      format: 'qrCode',
      symbolVersion: code.version,
      payload: parsePayload(code.data),
    }
  }
}
