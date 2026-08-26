import { XMLBuilder, XMLParser } from 'fast-xml-parser'
import { CORE_SCHEMA, dump as dumpYaml, load as loadYaml } from 'js-yaml'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import type { IToolUseCase } from '../ports/IToolUseCase'

export type DataFormat = 'json' | 'yaml' | 'toml' | 'xml'

const DATA_FORMAT_LABELS: Record<DataFormat, string> = {
  json: 'JSON',
  yaml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
}

export interface DataFormatConversionInput {
  source: string
  sourceFormat: DataFormat
  targetFormat: DataFormat
}

export interface DataFormatConversionResult {
  output: string
}

/**
 * Converts structured data between JSON, YAML, TOML and XML by parsing the
 * source into a canonical tree of plain object/array/string/number/boolean/
 * null values and re-serializing that tree in the target format.
 */
export class DataFormatConverter
  implements IToolUseCase<DataFormatConversionInput, DataFormatConversionResult>
{
  execute(input: DataFormatConversionInput): DataFormatConversionResult {
    if (input.source.trim().length === 0) {
      throw new Error('Input is empty')
    }

    let tree: unknown
    try {
      tree = decode(input.sourceFormat, input.source)
    } catch (e) {
      throw new Error(`Failed to parse ${DATA_FORMAT_LABELS[input.sourceFormat]} input: ${e}`)
    }

    const sanitized = sanitize(tree)

    try {
      const output = encode(input.targetFormat, sanitized)
      return { output }
    } catch (e) {
      throw new Error(`Failed to produce ${DATA_FORMAT_LABELS[input.targetFormat]} output: ${e}`)
    }
  }
}

function decode(format: DataFormat, source: string): unknown {
  switch (format) {
    case 'json':
      return JSON.parse(source)
    case 'yaml':
      return loadYaml(source)
    case 'toml':
      return parseToml(source)
    case 'xml':
      return decodeXml(source)
  }
}

function encode(format: DataFormat, tree: unknown): string {
  switch (format) {
    case 'json':
      return JSON.stringify(tree, null, 2)
    case 'yaml':
      return encodeYaml(tree)
    case 'toml':
      if (!isPlainObject(tree)) {
        throw new Error('TOML requires an object at the root')
      }
      return stringifyToml(tree as Record<string, unknown>)
    case 'xml':
      return encodeXml(tree)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Recursively normalizes a decoded tree to plain object/array/string/number/
 * boolean/null values. Exotic types with no direct JSON/YAML representation
 * (TOML date/time values, etc.) fall back to their canonical string form,
 * mirroring the Dart reference converter's `_sanitize`.
 */
function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map(sanitize)
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'object') {
    if (isPlainObject(value)) {
      const result: Record<string, unknown> = {}
      for (const [key, v] of Object.entries(value)) {
        result[key] = sanitize(v)
      }
      return result
    }
    return String(value)
  }
  return String(value)
}

const XML_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  // Dart's xml package never auto-parses element/attribute text into
  // numbers/booleans -- everything stays a string until re-encoded -- so
  // disable fast-xml-parser's value coercion to match.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
}

function decodeXml(source: string): unknown {
  const parser = new XMLParser(XML_PARSER_OPTIONS)
  return parser.parse(source)
}

function encodeXml(tree: unknown): string {
  if (!isPlainObject(tree) || Object.keys(tree).length === 0) {
    throw new Error('XML requires an object with a root element')
  }

  const entries = Object.entries(tree)
  let rootName: string
  let rootValue: unknown
  if (entries.length === 1 && !Array.isArray(entries[0]![1])) {
    rootName = entries[0]![0]
    rootValue = entries[0]![1]
  } else {
    rootName = 'root'
    rootValue = tree
  }

  const builder = new XMLBuilder({
    format: true,
    indentBy: '  ',
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    textNodeName: '#text',
    suppressEmptyNode: false,
  })
  const xml = builder.build({ [sanitizeXmlName(rootName)]: sanitizeXmlTree(rootValue) })
  return xml.replace(/^\n/, '')
}

function sanitizeXmlName(name: string): string {
  let sanitized = name.replace(/[^A-Za-z0-9_.-]/g, '_')
  if (sanitized.length === 0 || /^[0-9.-]/.test(sanitized)) {
    sanitized = `_${sanitized}`
  }
  return sanitized
}

/** Sanitizes element-name keys of an XML-shaped tree; leaves `@attr` and
 * `#text` keys untouched, matching the Dart converter's `_buildXmlElement`. */
function sanitizeXmlTree(value: unknown): unknown {
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      if (key.startsWith('@') || key === '#text') {
        result[key] = v
        continue
      }
      const sanitizedKey = sanitizeXmlName(key)
      result[sanitizedKey] = Array.isArray(v) ? v.map(sanitizeXmlTree) : sanitizeXmlTree(v)
    }
    return result
  }
  return value
}

function encodeYaml(tree: unknown): string {
  const output = dumpYaml(tree, { schema: CORE_SCHEMA })
  return output.length === 0 ? 'null\n' : output
}
