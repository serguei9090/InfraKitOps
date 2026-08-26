import { CORE_SCHEMA, dump, load } from 'js-yaml'
import type { IToolUseCase } from '../ports/IToolUseCase'

export type YamlFormatMode = 'pretty' | 'minify' | 'validate'

export interface YamlFormatterInput {
  source: string
  mode: YamlFormatMode
  indentSize?: number
}

export interface YamlFormatterResult {
  isValid: boolean
  output?: string
  errorMessage?: string
}

/**
 * YAML pretty-printer/minifier built on `js-yaml`'s `load`/`dump`. Uses
 * `CORE_SCHEMA` explicitly (rather than the dumper's default schema, which
 * also recognizes YAML 1.1 boolean shorthands like `y`/`n`/`yes`/`no`) so
 * plain strings that happen to look like those shorthands are not quoted
 * unnecessarily -- matching the Dart reference formatter's narrower reserved
 * word list. "minify" re-emits the document in single-line flow style
 * ({}/[]) since YAML has no whitespace-free representation the way JSON
 * does.
 */
export class YamlFormatter implements IToolUseCase<YamlFormatterInput, YamlFormatterResult> {
  execute(input: YamlFormatterInput): YamlFormatterResult {
    let parsed: unknown
    try {
      parsed = load(input.source)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { isValid: false, errorMessage: `Invalid YAML: ${message}` }
    }

    switch (input.mode) {
      case 'validate':
        return { isValid: true, output: 'Valid YAML' }
      case 'minify': {
        const output = dump(parsed, { schema: CORE_SCHEMA, flowLevel: 0 }).trim()
        return { isValid: true, output }
      }
      case 'pretty': {
        const output = dump(parsed, {
          schema: CORE_SCHEMA,
          indent: input.indentSize ?? 2,
        }).trim()
        return { isValid: true, output: output.length === 0 ? 'null' : output }
      }
    }
  }
}
