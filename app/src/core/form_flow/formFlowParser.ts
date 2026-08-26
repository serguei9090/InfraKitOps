/**
 * FormFlow's parsing/rendering engine: detects the structural shape
 * (fields, nesting, repeated groups) of an uploaded XML/YAML/JSON file and
 * re-serializes edited values back into the same format. Mirrors
 * `formflow_parser.dart`.
 *
 * ## Format detection
 * `parse` auto-detects the source format by trying, in order, JSON, then
 * XML, then YAML — the first one that parses successfully wins (matches
 * the Dart original's ordering rationale: a YAML document is rarely valid
 * JSON, and an XML document is rarely a valid YAML mapping, so ambiguity
 * in practice is minimal). Callers that already know the format can pass
 * `formatHint` to skip detection.
 *
 * ## Structural auto-detection rules
 * - A leaf scalar is `boolean` if its text is (case-insensitively)
 *   `true`/`false`, or the decoded JSON/YAML value is already a native
 *   boolean.
 * - A leaf scalar is `number` if its text matches an integer/decimal
 *   pattern, or the decoded value is already a native number.
 * - Anything else scalar is `text`.
 * - A single nested non-repeating group is `object`.
 * - A repeated sibling (multiple XML elements sharing a tag name, or a
 *   JSON/YAML list) is `array`, with `children` derived from the *first*
 *   occurrence/element.
 *
 * ## One tree-walker for all three formats
 * `fast-xml-parser`'s default (non-`preserveOrder`) mode already collapses
 * repeated same-name XML elements into an array and single occurrences
 * into a plain object/scalar — the exact same shape `JSON.parse` and
 * `js-yaml`'s `load` give for JSON/YAML. That means detection and
 * rendering for all three formats can share one generic Map/Array/scalar
 * tree-walker (`fieldsFromValue`/`valueForField`) instead of needing a
 * separate XML-element-tree code path, unlike the Dart original (whose
 * `package:xml` element tree wasn't already array-shaped for repeated
 * tags).
 *
 * ## Known limitations (same as the Dart original)
 * - XML attributes are ignored entirely — only element text/children are
 *   considered.
 * - `null` JSON/YAML values collapse to empty text; re-rendering does not
 *   restore `null` (there is no `FieldType` for it).
 * - Type inference is content-based and re-runs on every parse: a `text`
 *   field whose *current* value happens to look numeric/boolean will be
 *   re-detected as `number`/`boolean` if that rendered output is parsed
 *   again. Inherent to structural, content-driven auto-detection.
 */
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
import { CORE_SCHEMA, dump as dumpYaml, load as loadYaml } from 'js-yaml'
import type { IFormFlowUseCase } from '../ports/IFormFlowUseCase'
import {
  SCALAR_ARRAY_ITEM_KEY,
  isScalarArrayTemplate,
  type FieldType,
  type FormFlowSchema,
  type SchemaField,
  type SourceFormat,
} from './schemaModel'

const BOOL_PATTERN = /^(true|false)$/i
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/
const DEFAULT_ROOT_NAME = 'root'

const XML_PARSER_OPTIONS = {
  ignoreAttributes: true,
  // Leaf text always stays a string (matches Dart's xml package, which
  // never auto-parses element text into numbers/booleans) — type
  // inference below runs uniformly off the string content instead.
  parseTagValue: false,
  trimValues: true,
}

export class FormFlowParser implements IFormFlowUseCase<FormFlowSchema> {
  parse(rawContent: string, formatHint?: SourceFormat): FormFlowSchema {
    if (rawContent.trim().length === 0) {
      throw new Error('Content is empty')
    }

    if (formatHint) {
      switch (formatHint) {
        case 'json':
          return this.parseJson(rawContent)
        case 'xml':
          return this.parseXml(rawContent)
        case 'yaml':
          return this.parseYaml(rawContent)
      }
    }

    const errors: string[] = []
    try {
      return this.parseJson(rawContent)
    } catch (e) {
      errors.push(`as JSON: ${errorMessage(e)}`)
    }
    try {
      return this.parseXml(rawContent)
    } catch (e) {
      errors.push(`as XML: ${errorMessage(e)}`)
    }
    try {
      return this.parseYaml(rawContent)
    } catch (e) {
      errors.push(`as YAML: ${errorMessage(e)}`)
    }
    throw new Error(
      `Could not detect a supported format (tried JSON, XML, YAML):\n${errors.join('\n')}`,
    )
  }

  render(schema: FormFlowSchema, values: Record<string, unknown>): string {
    const map = mapFromFields(schema.fields, values)
    switch (schema.format) {
      case 'json':
        return `${JSON.stringify(map, null, 2)}\n`
      case 'yaml':
        return dumpYaml(map, { schema: CORE_SCHEMA, indent: 2 })
      case 'xml':
        return renderXml(schema.rootName, map)
    }
  }

  private parseJson(raw: string): FormFlowSchema {
    const decoded: unknown = JSON.parse(raw)
    if (!isPlainObject(decoded)) {
      throw new Error('JSON root must be an object')
    }
    return { format: 'json', rootName: DEFAULT_ROOT_NAME, fields: fieldsFromMap(decoded) }
  }

  private parseYaml(raw: string): FormFlowSchema {
    const decoded = loadYaml(raw, { schema: CORE_SCHEMA })
    if (!isPlainObject(decoded)) {
      throw new Error('YAML root must be a mapping')
    }
    return { format: 'yaml', rootName: DEFAULT_ROOT_NAME, fields: fieldsFromMap(decoded) }
  }

  private parseXml(raw: string): FormFlowSchema {
    // XMLParser itself is lenient (won't throw on e.g. an unclosed tag) —
    // XMLValidator is fast-xml-parser's own tool for that, see xmlFormatter.ts.
    const validation = XMLValidator.validate(raw)
    if (validation !== true) {
      throw new Error(validation.err.msg)
    }
    const parser = new XMLParser(XML_PARSER_OPTIONS)
    const decoded: unknown = parser.parse(raw)
    if (!isPlainObject(decoded)) {
      throw new Error('Malformed XML')
    }
    const entries = Object.entries(decoded).filter(([key]) => !key.startsWith('?'))
    if (entries.length !== 1) {
      throw new Error('XML must have exactly one root element')
    }
    const [rootName, rootValue] = entries[0]
    if (!isPlainObject(rootValue)) {
      // A root element with no child elements at all (e.g. `<config/>`).
      return { format: 'xml', rootName, fields: [] }
    }
    return { format: 'xml', rootName, fields: fieldsFromMap(rootValue) }
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------
// Generic Map/Array/scalar tree -> SchemaField[] (shared by XML/YAML/JSON)
// ---------------------------------------------------------------------

function fieldsFromMap(map: Record<string, unknown>): SchemaField[] {
  return Object.entries(map).map(([key, value]) => fieldFromKeyValue(key, value))
}

function fieldFromKeyValue(key: string, value: unknown): SchemaField {
  if (isPlainObject(value)) {
    return { key, type: 'object', children: fieldsFromMap(value) }
  }
  if (Array.isArray(value)) {
    return arrayFieldFromList(key, value)
  }
  return leafField(key, value)
}

function arrayFieldFromList(key: string, list: unknown[]): SchemaField {
  if (list.length === 0) {
    // Nothing to infer an item template from; documented limitation.
    return { key, type: 'array', children: [] }
  }
  const first = list[0]
  if (isPlainObject(first)) {
    return { key, type: 'array', children: fieldsFromMap(first) }
  }
  return { key, type: 'array', children: [leafField(SCALAR_ARRAY_ITEM_KEY, first)] }
}

function leafField(key: string, value: unknown): SchemaField {
  return { key, type: inferType(value), defaultValue: stringify(value), children: [] }
}

function inferType(raw: unknown): FieldType {
  if (typeof raw === 'boolean') return 'boolean'
  if (typeof raw === 'number') return 'number'
  const text = raw == null ? '' : String(raw)
  if (BOOL_PATTERN.test(text)) return 'boolean'
  if (NUMBER_PATTERN.test(text)) return 'number'
  return 'text'
}

function stringify(raw: unknown): string {
  return raw == null ? '' : String(raw)
}

// ---------------------------------------------------------------------
// SchemaField[] + values -> generic Map/Array/scalar tree (render)
// ---------------------------------------------------------------------

function mapFromFields(fields: SchemaField[], values: Record<string, unknown>): Record<string, unknown> {
  const map: Record<string, unknown> = {}
  for (const field of fields) {
    map[field.key] = valueForField(field, values[field.key])
  }
  return map
}

function valueForField(field: SchemaField, rawValue: unknown): unknown {
  switch (field.type) {
    case 'object': {
      const itemValues = isPlainObject(rawValue) ? rawValue : {}
      return mapFromFields(field.children, itemValues)
    }
    case 'array': {
      const items = Array.isArray(rawValue) ? rawValue : []
      if (isScalarArrayTemplate(field.children)) {
        const itemField = field.children[0]
        return items.map((item) =>
          valueForField(itemField, isPlainObject(item) ? item[SCALAR_ARRAY_ITEM_KEY] : item),
        )
      }
      return items.map((item) => mapFromFields(field.children, isPlainObject(item) ? item : {}))
    }
    case 'boolean':
      return coerceBool(rawValue, field.defaultValue)
    case 'number':
      return coerceNumber(rawValue, field.defaultValue)
    case 'text':
      return rawValue?.toString() ?? field.defaultValue ?? ''
  }
}

function coerceBool(rawValue: unknown, fallback: string | undefined): boolean {
  if (typeof rawValue === 'boolean') return rawValue
  const text = rawValue?.toString() ?? fallback ?? 'false'
  return text.toLowerCase() === 'true'
}

function coerceNumber(rawValue: unknown, fallback: string | undefined): number {
  if (typeof rawValue === 'number') return rawValue
  const text = rawValue?.toString() ?? fallback ?? '0'
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : 0
}

// ---------------------------------------------------------------------
// XML rendering
// ---------------------------------------------------------------------

function renderXml(rootName: string, map: Record<string, unknown>): string {
  const builder = new XMLBuilder({
    format: true,
    indentBy: '  ',
    ignoreAttributes: true,
    suppressEmptyNode: false,
  })
  const xml = builder.build({ [rootName]: map }) as string
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml.replace(/^\n/, '')}`
}
