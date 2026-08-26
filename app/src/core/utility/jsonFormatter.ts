import type { IToolUseCase } from '../ports/IToolUseCase'

export type JsonFormatMode = 'pretty' | 'minify' | 'validate'

export interface JsonFormatterInput {
  source: string
  mode: JsonFormatMode
  indent?: string
}

export interface JsonFormatterResult {
  isValid: boolean
  output?: string
  errorMessage?: string
}

export class JsonFormatter implements IToolUseCase<JsonFormatterInput, JsonFormatterResult> {
  execute(input: JsonFormatterInput): JsonFormatterResult {
    let decoded: unknown
    try {
      decoded = JSON.parse(input.source)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { isValid: false, errorMessage: `Invalid JSON: ${message}` }
    }

    switch (input.mode) {
      case 'validate':
        return { isValid: true, output: 'Valid JSON' }
      case 'pretty':
        return { isValid: true, output: JSON.stringify(decoded, null, input.indent ?? '  ') }
      case 'minify':
        return { isValid: true, output: JSON.stringify(decoded) }
    }
  }
}
