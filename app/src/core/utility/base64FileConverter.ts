import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * How the Base64 payload should be presented once a file has been encoded.
 *
 * `Base64Converter` (`base64Converter.ts`) is UTF-8 *text* only -- it round
 * trips a string through `TextEncoder`/`TextDecoder`, which destroys any
 * byte that is not valid UTF-8. This module covers the binary case instead.
 */
export type Base64Wrapping = 'plain' | 'dataUri' | 'k8sSecret'

export interface Base64FileEncodeInput {
  bytes: Uint8Array
  wrapping?: Base64Wrapping
  /** MIME type used by `'dataUri'`. Defaults to `application/octet-stream`. */
  mimeType?: string
  /** `metadata.name` for `'k8sSecret'`. */
  secretName?: string
  /** Key under `data:` for `'k8sSecret'`. */
  secretKey?: string
  /** Wrap the Base64 at this column (e.g. 76 for MIME style). Undefined
   * keeps it on one line, which is what data URIs and k8s secrets require --
   * so this is ignored for those wrappings. */
  lineLength?: number
}

export interface Base64FileEncodeResult {
  /** The text to show/copy, including any wrapping. */
  output: string
  /** The bare single-line Base64 payload, wrapping aside. */
  base64: string
  /** Size of the source bytes. */
  byteSize: number
  /** Length of the bare Base64 payload -- roughly 4/3 of `byteSize`. */
  encodedLength: number
}

export interface Base64FileDecodeInput {
  /** Plain Base64, a data URI, or Base64 pasted with line breaks. The
   * URL-safe alphabet and missing `=` padding are both tolerated. */
  text: string
}

export interface Base64FileDecodeResult {
  bytes: Uint8Array
  /** MIME type recovered from a data URI prefix, if there was one. */
  mimeType?: string
  byteSize: number
}

const CHUNK_SIZE = 0x8000

/** `Uint8Array` -> Base64, chunked so `String.fromCharCode(...bytes)` never
 * blows the call stack on large files. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE))
  }
  return btoa(binary)
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function wrapLines(text: string, width: number): string {
  const lines: string[] = []
  for (let i = 0; i < text.length; i += width) {
    lines.push(text.slice(i, i + width))
  }
  return lines.join('\n')
}

/** RFC 1123 subdomain, which is what `metadata.name` must be. */
function sanitizeK8sName(name: string): string {
  let s = name.toLowerCase().replace(/[^a-z0-9.-]/g, '-')
  s = s.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
  return s.length === 0 ? 'my-secret' : s
}

/** Secret `data:` keys allow alphanumerics, `-`, `_` and `.`. */
function sanitizeK8sKey(key: string): string {
  const s = key.replace(/[^A-Za-z0-9._-]/g, '-')
  return s.length === 0 ? 'file' : s
}

function buildK8sSecret(payload: string, name: string, key: string): string {
  const safeName = sanitizeK8sName(name)
  const safeKey = sanitizeK8sKey(key)
  return (
    'apiVersion: v1\n' +
    'kind: Secret\n' +
    'metadata:\n' +
    `  name: ${safeName}\n` +
    'type: Opaque\n' +
    'data:\n' +
    `  ${safeKey}: ${payload}\n`
  )
}

/** Encodes arbitrary file bytes to Base64, optionally wrapped as a data URI
 * or a Kubernetes Secret manifest. */
export class Base64FileEncoder
  implements IToolUseCase<Base64FileEncodeInput, Base64FileEncodeResult>
{
  execute(input: Base64FileEncodeInput): Base64FileEncodeResult {
    if (input.bytes.length === 0) {
      throw new Error('Input is empty')
    }
    if (input.lineLength !== undefined && input.lineLength < 4) {
      throw new Error('Line length must be at least 4')
    }

    const encoded = bytesToBase64(input.bytes)
    const wrapping = input.wrapping ?? 'plain'

    let output: string
    switch (wrapping) {
      case 'plain':
        output = input.lineLength === undefined ? encoded : wrapLines(encoded, input.lineLength)
        break
      case 'dataUri':
        output = `data:${input.mimeType ?? 'application/octet-stream'};base64,${encoded}`
        break
      case 'k8sSecret':
        output = buildK8sSecret(encoded, input.secretName ?? 'my-secret', input.secretKey ?? 'file')
        break
    }

    return {
      output,
      base64: encoded,
      byteSize: input.bytes.length,
      encodedLength: encoded.length,
    }
  }
}

const DATA_URI_PATTERN = /^data:([^;,]*)((?:;[^;,]*)*);base64,/i

/** Bare Base64 -> bytes, tolerating whitespace/newlines, the URL-safe
 * alphabet (`-_`) and missing `=` padding. */
function decodeToBytes(text: string): Uint8Array {
  const cleaned = text.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (cleaned.length === 0) {
    throw new Error('Input is empty')
  }
  const padded =
    cleaned.length % 4 === 0
      ? cleaned
      : cleaned.padEnd(cleaned.length + (4 - (cleaned.length % 4)), '=')
  try {
    return base64ToBytes(padded)
  } catch (e) {
    throw new Error(`Invalid Base64 input: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Decodes Base64 (plain, wrapped, URL-safe or data-URI) back into the
 * original file bytes. */
export class Base64FileDecoder
  implements IToolUseCase<Base64FileDecodeInput, Base64FileDecodeResult>
{
  execute(input: Base64FileDecodeInput): Base64FileDecodeResult {
    let text = input.text.trim()
    if (text.length === 0) {
      throw new Error('Input is empty')
    }

    let mimeType: string | undefined
    const match = DATA_URI_PATTERN.exec(text)
    if (match !== null) {
      const declared = match[1]?.trim()
      mimeType = declared === undefined || declared.length === 0 ? 'text/plain' : declared
      text = text.slice(match[0].length)
    } else if (text.toLowerCase().startsWith('data:')) {
      throw new Error(
        'That looks like a data URI but it is not Base64-encoded (no ";base64," marker).',
      )
    }

    const bytes = decodeToBytes(text)
    return { bytes, mimeType, byteSize: bytes.length }
  }
}

/** Filename-extension -> MIME type lookup, so the data-URI wrapping can be
 * filled in automatically for a dropped file instead of always saying
 * `application/octet-stream`. */
export function guessMimeType(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0 || dot === fileName.length - 1) return 'application/octet-stream'
  const extension = fileName.slice(dot + 1).toLowerCase()
  const known: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    pdf: 'application/pdf',
    json: 'application/json',
    yaml: 'application/yaml',
    yml: 'application/yaml',
    xml: 'application/xml',
    zip: 'application/zip',
    gz: 'application/gzip',
    tar: 'application/x-tar',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    crt: 'application/x-x509-ca-cert',
    pem: 'application/x-pem-file',
    key: 'application/x-pem-file',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    webm: 'video/webm',
  }
  return known[extension] ?? 'application/octet-stream'
}

/** Best-effort extension for a MIME type recovered from a data URI, used to
 * suggest a filename in the Save-As dialog. */
export function extensionForMimeType(mimeType: string | null | undefined): string {
  if (mimeType == null) return 'bin'
  const normalized = mimeType.toLowerCase().trim()
  const known: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'image/tiff': 'tif',
    'application/pdf': 'pdf',
    'application/json': 'json',
    'application/yaml': 'yaml',
    'application/xml': 'xml',
    'application/zip': 'zip',
    'application/gzip': 'gz',
    'application/x-tar': 'tar',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/csv': 'csv',
    'text/html': 'html',
    'text/css': 'css',
    'text/javascript': 'js',
    'font/woff': 'woff',
    'font/woff2': 'woff2',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  }
  return known[normalized] ?? 'bin'
}
