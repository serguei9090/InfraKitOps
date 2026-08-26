import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Field separator. European Excel opens `.csv` with `;`, US/UK Excel with
 * `,`, so this has to be selectable or half the users get one column.
 */
export type CsvDelimiter = 'comma' | 'semicolon' | 'tab'

export const CSV_DELIMITERS: Record<CsvDelimiter, { label: string; character: string }> = {
  comma: { label: 'Comma  ,', character: ',' },
  semicolon: { label: 'Semicolon  ;', character: ';' },
  tab: { label: 'Tab', character: '\t' },
}

/**
 * RFC 4180 specifies CRLF, and that is what Excel is happiest with, but
 * `\n` is friendlier for anything Unix-side.
 */
export type CsvLineEnding = 'crlf' | 'lf'

export const CSV_LINE_ENDINGS: Record<CsvLineEnding, { label: string; sequence: string }> = {
  crlf: { label: 'CRLF  (RFC 4180)', sequence: '\r\n' },
  lf: { label: 'LF  (Unix)', sequence: '\n' },
}

/** How a nested JSON array is turned into CSV. */
export type CsvArrayHandling = 'indexedColumns' | 'jsonEncoded'

export const CSV_ARRAY_HANDLING_LABELS: Record<CsvArrayHandling, string> = {
  /**
   * **Default.** Index-suffixed columns: `{"tags":["a","b"]}` becomes the
   * columns `tags.0` and `tags.1`, matching the dotted-path flattening used
   * for nested objects. Objects inside arrays keep flattening, so
   * `{"users":[{"name":"x"}]}` becomes `users.0.name`.
   */
  indexedColumns: 'Index-suffixed columns  (tags.0, tags.1)',
  /**
   * The whole array is compact-JSON-encoded into one cell:
   * `{"tags":["a","b"]}` becomes the single column `tags` holding
   * `["a","b"]`. Keeps the column count stable when array lengths vary.
   */
  jsonEncoded: 'JSON-encoded in one cell  (["a","b"])',
}

export interface JsonToCsvInput {
  /** A JSON array of objects, as text. */
  json: string
  delimiter?: CsvDelimiter
  lineEnding?: CsvLineEnding
  arrayHandling?: CsvArrayHandling
  includeHeader?: boolean
}

export interface JsonToCsvResult {
  csv: string
  /** Column order: union of every object's keys, in first-seen order. */
  headers: string[]
  /** Data rows, excluding the header line. */
  rowCount: number
}

/**
 * Converts a JSON array of objects into RFC 4180 CSV.
 *
 * ## What it does with messy input
 * - **Differing key sets** — the header is the union of all keys in
 *   first-seen order; a row missing a key gets an empty cell.
 * - **Nested objects** — flattened to dotted paths (`user.name`).
 * - **Nested arrays** — see `CsvArrayHandling`; the default is
 *   index-suffixed columns (`tags.0`, `tags.1`).
 * - **null** — an empty cell, so it is indistinguishable from a missing
 *   key. That is the conventional CSV behaviour; CSV has no null.
 * - **Empty object / empty array values** — contribute no columns.
 *
 * ## Quoting (RFC 4180 §2)
 * A field is quoted when it contains the delimiter, a double quote, CR or
 * LF; embedded double quotes are doubled. Everything else is written bare.
 */
export class JsonToCsvConverter implements IToolUseCase<JsonToCsvInput, JsonToCsvResult> {
  execute(input: JsonToCsvInput): JsonToCsvResult {
    if (input.json.trim().length === 0) {
      throw new Error('Input is empty')
    }

    let decoded: unknown
    try {
      decoded = JSON.parse(input.json)
    } catch (e) {
      throw new Error(`Invalid JSON: ${(e as Error).message}`)
    }

    if (!Array.isArray(decoded)) {
      throw new Error('Expected a JSON array of objects at the top level, e.g. [{"a": 1}, {"a": 2}].')
    }
    if (decoded.length === 0) {
      throw new Error('The JSON array is empty — there are no rows to convert.')
    }

    const arrayHandling = input.arrayHandling ?? 'indexedColumns'

    // Flatten every row first so the header can be the union of all keys.
    const rows: Record<string, string>[] = []
    const headers: string[] = []

    for (let i = 0; i < decoded.length; i++) {
      const element = decoded[i]
      if (typeof element !== 'object' || element === null || Array.isArray(element)) {
        throw new Error(
          `Element ${i + 1} of the array is a ${typeName(element)}, not an object. ` +
            'Every element must be a JSON object so it can become a CSV row.',
        )
      }
      const flat: Record<string, string> = {}
      flatten(element as Record<string, unknown>, '', flat, arrayHandling)
      for (const key of Object.keys(flat)) {
        if (!headers.includes(key)) headers.push(key)
      }
      rows.push(flat)
    }

    const delimiter = CSV_DELIMITERS[input.delimiter ?? 'comma'].character
    const eol = CSV_LINE_ENDINGS[input.lineEnding ?? 'crlf'].sequence
    const includeHeader = input.includeHeader ?? true

    let out = ''
    if (includeHeader) {
      out += headers.map((h) => escapeCsvField(h, delimiter)).join(delimiter)
      out += eol
    }
    for (const row of rows) {
      out += headers.map((h) => escapeCsvField(row[h] ?? '', delimiter)).join(delimiter)
      out += eol
    }

    return { csv: out, headers, rowCount: rows.length }
  }
}

/**
 * RFC 4180 §2 field escaping. Exported so the CSV rules are directly
 * testable rather than only observable through a whole conversion.
 */
export function escapeCsvField(value: string, delimiter: string): string {
  const needsQuotes = value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')
  if (!needsQuotes) return value
  return `"${value.replace(/"/g, '""')}"`
}

function flatten(
  source: Record<string, unknown>,
  prefix: string,
  out: Record<string, string>,
  arrays: CsvArrayHandling,
): void {
  for (const [key, value] of Object.entries(source)) {
    const fullKey = prefix.length === 0 ? key : `${prefix}.${key}`
    flattenValue(value, fullKey, out, arrays)
  }
}

function flattenValue(value: unknown, key: string, out: Record<string, string>, arrays: CsvArrayHandling): void {
  if (Array.isArray(value)) {
    if (value.length === 0) return
    if (arrays === 'jsonEncoded') {
      out[key] = JSON.stringify(value)
    } else {
      for (let i = 0; i < value.length; i++) {
        flattenValue(value[i], `${key}.${i}`, out, arrays)
      }
    }
    return
  }
  if (typeof value === 'object' && value !== null) {
    if (Object.keys(value).length === 0) return
    flatten(value as Record<string, unknown>, key, out, arrays)
    return
  }
  out[key] = scalar(value)
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return String(value)
}

function typeName(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'string'
  return typeof value
}
