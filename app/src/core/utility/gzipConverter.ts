import * as pako from 'pako'
import type { IToolUseCase } from '../ports/IToolUseCase'

/** What `GzipConverter` should do with the bytes it is handed. */
export type GzipOperation = 'compress' | 'decompress'

export interface GzipConversionInput {
  /** Raw bytes to compress, or the gzip stream to decompress. */
  data: Uint8Array
  operation: GzipOperation
  /** Deflate level 0-9 (compress only). Undefined uses the encoder default (6). */
  level?: number
}

export interface GzipConversionResult {
  /** The produced bytes: the gzip stream when compressing, the recovered
   * payload when decompressing. */
  data: Uint8Array
  inputSize: number
  operation: GzipOperation
  outputSize: number
  /** Size of the payload in its uncompressed form, whichever side of the
   * conversion it happened to be on. */
  originalSize: number
  /** Size of the payload in its gzip form. */
  compressedSize: number
  /** compressed / original. 0.12 means the gzip stream is 12% of the
   * original size. Values above 1 are possible (and normal) for tiny or
   * already-compressed inputs, because gzip adds an 18-byte frame. */
  compressionRatio: number
  /** How much was saved, as a percentage. Negative when gzip made the
   * payload bigger. */
  spaceSavingPercent: number
  /** The output bytes as standard Base64 -- how gzipped payloads normally
   * travel when they have to be pasted into a config file, ticket or shell. */
  base64: string
  /** The output bytes decoded as UTF-8 text, or null when they are not
   * valid UTF-8 (i.e. the payload is genuinely binary). */
  textOrNull: string | null
}

/** First two bytes of every gzip stream (RFC 1952 2.3.1). */
const MAGIC0 = 0x1f
const MAGIC1 = 0x8b

/** True when `bytes` starts with the gzip magic number. Used to reject
 * obviously-wrong input before handing it to the decoder. */
export function looksLikeGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === MAGIC0 && bytes[1] === MAGIC1
}

const CHUNK_SIZE = 0x8000

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

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function buildResult(
  data: Uint8Array,
  inputSize: number,
  operation: GzipOperation,
): GzipConversionResult {
  const outputSize = data.length
  const originalSize = operation === 'compress' ? inputSize : outputSize
  const compressedSize = operation === 'compress' ? outputSize : inputSize
  const compressionRatio = originalSize === 0 ? 0 : compressedSize / originalSize
  const spaceSavingPercent = originalSize === 0 ? 0 : (1 - compressionRatio) * 100
  const base64 = bytesToBase64(data)
  let textOrNull: string | null
  try {
    textOrNull = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    textOrNull = null
  }

  return {
    data,
    inputSize,
    operation,
    outputSize,
    originalSize,
    compressedSize,
    compressionRatio,
    spaceSavingPercent,
    base64,
    textOrNull,
  }
}

/** Turns pasted Base64 into bytes, tolerating wrapped lines, missing padding
 * and the URL-safe alphabet -- all three are common when a gzipped blob has
 * been through a terminal or a YAML file. */
export function parseBase64(text: string): Uint8Array {
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
    throw new Error(`Invalid Base64 input: ${errorMessage(e)}`)
  }
}

function compress(bytes: Uint8Array, level: number | undefined): GzipConversionResult {
  if (bytes.length === 0) {
    throw new Error('Input is empty')
  }
  if (level !== undefined && (level < 0 || level > 9)) {
    throw new Error('Compression level must be between 0 and 9')
  }

  let encoded: Uint8Array
  try {
    encoded = level === undefined ? pako.gzip(bytes) : pako.gzip(bytes, { level })
  } catch (e) {
    throw new Error(`GZip compression failed: ${errorMessage(e)}`)
  }

  return buildResult(encoded, bytes.length, 'compress')
}

function decompress(bytes: Uint8Array): GzipConversionResult {
  if (bytes.length === 0) {
    throw new Error('Input is empty')
  }
  if (!looksLikeGzip(bytes)) {
    throw new Error(
      'Not a GZip stream: the data does not start with the gzip magic number (0x1f 0x8b).',
    )
  }

  let decoded: Uint8Array
  try {
    decoded = pako.ungzip(bytes)
  } catch (e) {
    // Truncated streams, CRC mismatches and corrupt deflate blocks all
    // surface here; none of them should escape as a raw codec error.
    throw new Error(`GZip decompression failed: ${errorMessage(e)}`)
  }

  // pako only rejects a stream that fails its own internal buffer/CRC
  // checks -- a stream cut off exactly at a chunk boundary with no trailer
  // at all can decode "successfully" to a truncated result instead of
  // throwing. The gzip footer's last 4 bytes are ISIZE, the uncompressed
  // size mod 2^32; checking it ourselves catches truncation pako's own
  // leniency misses.
  if (bytes.length >= 8) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const isize = view.getUint32(bytes.length - 4, true)
    if (decoded.length % 0x100000000 !== isize) {
      throw new Error(
        'GZip decompression failed: the stream is truncated or corrupt (decoded size does not match the gzip trailer).',
      )
    }
  }

  return buildResult(decoded, bytes.length, 'decompress')
}

/**
 * GZip compression/decompression built on `pako`, a pure-JS zlib port that
 * works identically in the browser, Tauri's webview and Node -- unlike
 * Node's own `zlib` module, which is unavailable in a browser build.
 *
 * Every failure path (garbage input, truncated stream, bad level) leaves
 * this class throwing a plain `Error`; nothing from the underlying codec
 * escapes uncaught.
 */
export class GzipConverter implements IToolUseCase<GzipConversionInput, GzipConversionResult> {
  execute(input: GzipConversionInput): GzipConversionResult {
    switch (input.operation) {
      case 'compress':
        return compress(input.data, input.level)
      case 'decompress':
        return decompress(input.data)
    }
  }

  /** Compresses UTF-8 text. Convenience for the text-oriented UI path. */
  compressText(text: string, level?: number): GzipConversionResult {
    if (text.length === 0) {
      throw new Error('Input is empty')
    }
    return compress(new TextEncoder().encode(text), level)
  }

  /** Compresses arbitrary bytes (e.g. a dropped file). */
  compressBytes(bytes: Uint8Array, level?: number): GzipConversionResult {
    return compress(bytes, level)
  }

  /** Decompresses a raw gzip stream. */
  decompressBytes(bytes: Uint8Array): GzipConversionResult {
    return decompress(bytes)
  }

  /** Decompresses a gzip stream that was pasted in as Base64. */
  decompressBase64(text: string): GzipConversionResult {
    return decompress(parseBase64(text))
  }
}
