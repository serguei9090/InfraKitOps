import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
import type { IToolUseCase } from '../ports/IToolUseCase'

export type XmlFormatMode = 'pretty' | 'minify' | 'validate'

export interface XmlFormatterInput {
  source: string
  mode: XmlFormatMode
  indent?: string
}

export interface XmlFormatterResult {
  isValid: boolean
  output?: string
  errorMessage?: string
}

// `preserveOrder` keeps element/text ordering, comments and attributes
// intact through a parse+rebuild round trip -- what a formatter needs,
// unlike the "flatten to a plain object" mode used for data-format
// conversion elsewhere in this module.
const PARSER_OPTIONS = {
  ignoreAttributes: false,
  preserveOrder: true,
  trimValues: true,
}

export class XmlFormatter implements IToolUseCase<XmlFormatterInput, XmlFormatterResult> {
  execute(input: XmlFormatterInput): XmlFormatterResult {
    const validation = XMLValidator.validate(input.source)
    if (validation !== true) {
      return { isValid: false, errorMessage: `Invalid XML: ${validation.err.msg}` }
    }

    switch (input.mode) {
      case 'validate':
        return { isValid: true, output: 'Valid XML' }
      case 'pretty': {
        const output = rebuild(input.source, { format: true, indentBy: input.indent ?? '  ' })
        // The builder emits a leading newline before the root element in
        // pretty mode; strip it so the output starts at the root tag.
        return { isValid: true, output: output.replace(/^\n/, '') }
      }
      case 'minify':
        return { isValid: true, output: rebuild(input.source, { format: false }) }
    }
  }
}

function rebuild(source: string, buildOptions: { format: boolean; indentBy?: string }): string {
  const parser = new XMLParser(PARSER_OPTIONS)
  const parsed = parser.parse(source)
  const builder = new XMLBuilder({ preserveOrder: true, ignoreAttributes: false, ...buildOptions })
  return builder.build(parsed)
}
