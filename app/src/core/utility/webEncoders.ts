import type { IToolUseCase } from '../ports/IToolUseCase'

export type WebEncodingOperation = 'urlEncode' | 'urlDecode' | 'htmlEscape' | 'htmlUnescape'

export interface WebEncodingInput {
  text: string
  operation: WebEncodingOperation
}

export interface WebEncodingResult {
  output: string
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

const ENTITY_PATTERN = /&(#[xX][0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);/g

/**
 * URL percent-encoding and HTML entity escaping, both hand-rolled since
 * neither needs a package: `encodeURIComponent`/`decodeURIComponent` already
 * expose percent-encoding, and the HTML entity set required here is small
 * and fixed.
 */
export class WebEncoder implements IToolUseCase<WebEncodingInput, WebEncodingResult> {
  execute(input: WebEncodingInput): WebEncodingResult {
    switch (input.operation) {
      case 'urlEncode':
        return { output: encodeURIComponent(input.text) }
      case 'urlDecode':
        return { output: urlDecode(input.text) }
      case 'htmlEscape':
        return { output: htmlEscape(input.text) }
      case 'htmlUnescape':
        return { output: htmlUnescape(input.text) }
    }
  }
}

function urlDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    throw new Error('Invalid percent-encoded input')
  }
}

function htmlEscape(text: string): string {
  return text.replace(/[&<>"']/g, (m) => HTML_ESCAPES[m]!)
}

function htmlUnescape(text: string): string {
  return text.replace(ENTITY_PATTERN, (match, token: string) => {
    if (token.startsWith('#x') || token.startsWith('#X')) {
      const code = parseInt(token.substring(2), 16)
      return String.fromCharCode(code)
    }
    if (token.startsWith('#')) {
      const code = parseInt(token.substring(1), 10)
      return String.fromCharCode(code)
    }
    return NAMED_ENTITIES[token] ?? match
  })
}
