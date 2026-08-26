import type { IToolUseCase } from '../ports/IToolUseCase'

export type Base64Operation = 'encode' | 'decode'

export interface Base64ConversionInput {
  text: string
  operation: Base64Operation
}

export interface Base64ConversionResult {
  output: string
}

/** Encodes/decodes UTF-8 text to and from standard Base64. */
export class Base64Converter
  implements IToolUseCase<Base64ConversionInput, Base64ConversionResult>
{
  execute(input: Base64ConversionInput): Base64ConversionResult {
    switch (input.operation) {
      case 'encode':
        return { output: bytesToBase64(new TextEncoder().encode(input.text)) }
      case 'decode':
        return { output: decode(input.text) }
    }
  }
}

function decode(text: string): string {
  const cleaned = text.replace(/\s/g, '')
  if (cleaned.length === 0) {
    throw new Error('Input is empty')
  }

  // Accept input pasted without its trailing '=' padding by restoring it,
  // since that is the most common way hand-typed Base64 breaks.
  const padded =
    cleaned.length % 4 === 0
      ? cleaned
      : cleaned.padEnd(cleaned.length + (4 - (cleaned.length % 4)), '=')

  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(padded)
  } catch (e) {
    throw new Error(`Invalid Base64 input: ${errorMessage(e)}`)
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (e) {
    throw new Error(`Invalid Base64 input: ${errorMessage(e)}`)
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const CHUNK_SIZE = 0x8000

/** `Uint8Array` -> Base64, chunked so `String.fromCharCode(...bytes)` never
 * blows the call stack on large inputs. */
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
