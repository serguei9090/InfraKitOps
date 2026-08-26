import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * One value the expression selected, together with the normalised path that
 * identifies where it lives in the document.
 */
export interface JsonPathMatch {
  /** Bracket-notation path, e.g. `$['store']['book'][0]['title']`. */
  path: string
  /** The selected value — an object, array, string, number, boolean, or null. */
  value: unknown
}

/** The value rendered as pretty JSON, for display. */
export function jsonPathPrettyValue(match: JsonPathMatch): string {
  try {
    const rendered = JSON.stringify(match.value, null, 2)
    return rendered === undefined ? String(match.value) : rendered
  } catch {
    return String(match.value)
  }
}

/** A short one-line rendering, for list rows. */
export function jsonPathCompactValue(match: JsonPathMatch): string {
  try {
    const rendered = JSON.stringify(match.value)
    return rendered === undefined ? String(match.value) : rendered
  } catch {
    return String(match.value)
  }
}

export interface JsonPathEvaluatorInput {
  /**
   * The JSON document, as text. Parsed here so malformed JSON produces a
   * clean error result rather than an exception at the call site.
   */
  document: string
  /** The JSONPath expression, e.g. `$.store.book[?(@.price < 10)].title`. */
  expression: string
}

export interface JsonPathResult {
  isValid: boolean
  errorMessage?: string
  matches: JsonPathMatch[]
}

export function jsonPathMatchCount(result: JsonPathResult): number {
  return result.matches.length
}

/**
 * All matched values as a pretty-printed JSON array — the natural "result"
 * blob for a copy button.
 */
export function jsonPathPrettyValues(result: JsonPathResult): string {
  try {
    const rendered = JSON.stringify(
      result.matches.map((m) => m.value),
      null,
      2,
    )
    return rendered ?? '[]'
  } catch {
    return '[]'
  }
}

function emptyResult(errorMessage: string): JsonPathResult {
  return { isValid: false, errorMessage, matches: [] }
}

/**
 * A hand-written evaluator for the commonly-used subset of JSONPath.
 *
 * ## Supported
 *
 * | Syntax | Meaning |
 * |---|---|
 * | `$` | the root node (an expression must start here) |
 * | `.name` | child by name |
 * | `['name']`, `["name"]` | child by name (quoted, so keys with dots/spaces work) |
 * | `.*`, `[*]` | wildcard — every child of an object or array |
 * | `[0]` | array index |
 * | `[-1]` | negative index, counting back from the end |
 * | `[start:end]`, `[start:end:step]` | array slice; any part may be omitted, negatives count from the end, a negative step walks backwards |
 * | `..name` | recursive descent — every `name` child at any depth |
 * | `..*` | every descendant value |
 * | `..[0]` | a bracket selector applied to every descendant |
 * | `[?(@.x == 'a')]` | filter by comparison against a literal, using `==`, `!=`, `<`, `<=`, `>`, `>=` |
 * | `[?(@.x)]` | filter by existence of a (non-null) member |
 *
 * Filter left-hand sides may be `@`, `@.a`, `@.a.b`, or `@['a']['b']`.
 * Literals may be numbers, single- or double-quoted strings, `true`, `false`,
 * and `null`. `<`, `<=`, `>`, `>=` compare numbers numerically and strings
 * lexicographically; a mismatched pair simply does not match.
 *
 * ## Deliberately NOT supported
 *
 * These raise a clear error instead of silently returning wrong results:
 *
 * - boolean combinators in filters — `&&`, `||`, `!`;
 * - regex match filters — `[?(@.name =~ /pattern/)]`;
 * - nested/sub-path filters and function extensions — `[?(@.a[0].b > 1)]` is
 *   fine (plain member chains work), but `length()`, `count()`, `match()`,
 *   `search()`, and script expressions `[(...)]` are not;
 * - union selectors — `['a','b']` and `[0,1]`;
 * - parent/sibling navigation, since JSONPath has no such operator;
 * - `$` appearing anywhere other than the start of the expression.
 *
 * ## Result ordering
 *
 * Matches come back in document order (pre-order traversal), which is what
 * recursive descent and wildcards are usually read as producing.
 */
export class JsonPathEvaluator implements IToolUseCase<JsonPathEvaluatorInput, JsonPathResult> {
  execute(input: JsonPathEvaluatorInput): JsonPathResult {
    if (input.document.trim().length === 0) {
      return emptyResult('Paste a JSON document to query.')
    }

    let document: unknown
    try {
      document = JSON.parse(input.document)
    } catch (e) {
      return emptyResult(`Invalid JSON document: ${(e as Error).message}`)
    }

    if (input.expression.trim().length === 0) {
      return emptyResult('Enter a JSONPath expression, e.g. $.store.book[*].title')
    }

    let segments: Segment[]
    try {
      segments = parseExpression(input.expression.trim())
    } catch (e) {
      if (e instanceof JsonPathError) return emptyResult(e.message)
      return emptyResult(`Could not parse expression: ${(e as Error).message}`)
    }

    try {
      let nodes: JsonPathMatch[] = [{ path: '$', value: document }]
      for (const segment of segments) {
        const next: JsonPathMatch[] = []
        for (const node of nodes) {
          segment.apply(node, next)
        }
        nodes = next
      }
      return { isValid: true, matches: nodes }
    } catch (e) {
      if (e instanceof JsonPathError) return emptyResult(e.message)
      return emptyResult(`Evaluation failed: ${(e as Error).message}`)
    }
  }
}

class JsonPathError extends Error {}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

interface Segment {
  /** Append every node this segment selects from `node` onto `out`. */
  apply(node: JsonPathMatch, out: JsonPathMatch[]): void
}

class ChildSegment implements Segment {
  private readonly name: string
  constructor(name: string) {
    this.name = name
  }

  apply(node: JsonPathMatch, out: JsonPathMatch[]): void {
    const value = node.value
    if (isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, this.name)) {
      out.push({ path: `${node.path}['${this.name}']`, value: (value as Record<string, unknown>)[this.name] })
    }
  }
}

class WildcardSegment implements Segment {
  apply(node: JsonPathMatch, out: JsonPathMatch[]): void {
    const value = node.value
    if (isPlainObject(value)) {
      for (const key of Object.keys(value)) {
        out.push({ path: `${node.path}['${key}']`, value: (value as Record<string, unknown>)[key] })
      }
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        out.push({ path: `${node.path}[${i}]`, value: value[i] })
      }
    }
  }
}

class IndexSegment implements Segment {
  private readonly index: number
  constructor(index: number) {
    this.index = index
  }

  apply(node: JsonPathMatch, out: JsonPathMatch[]): void {
    const value = node.value
    if (!Array.isArray(value)) return
    const resolved = this.index < 0 ? value.length + this.index : this.index
    if (resolved < 0 || resolved >= value.length) return
    out.push({ path: `${node.path}[${resolved}]`, value: value[resolved] })
  }
}

class SliceSegment implements Segment {
  private readonly start: number | null
  private readonly end: number | null
  private readonly step: number
  constructor(start: number | null, end: number | null, step: number) {
    this.start = start
    this.end = end
    this.step = step
  }

  apply(node: JsonPathMatch, out: JsonPathMatch[]): void {
    const value = node.value
    if (!Array.isArray(value)) return
    const length = value.length
    if (length === 0) return

    const normalise = (raw: number): number => {
      const resolved = raw < 0 ? length + raw : raw
      return resolved < 0 ? 0 : resolved > length ? length : resolved
    }

    if (this.step > 0) {
      const from = this.start === null ? 0 : normalise(this.start)
      const to = this.end === null ? length : normalise(this.end)
      for (let i = from; i < to; i += this.step) {
        out.push({ path: `${node.path}[${i}]`, value: value[i] })
      }
    } else {
      // Negative step walks backwards; bounds clamp to length-1 / -1.
      let from = this.start === null ? length - 1 : this.start < 0 ? length + this.start : this.start
      let to = this.end === null ? -1 : this.end < 0 ? length + this.end : this.end
      if (from > length - 1) from = length - 1
      if (to < -1) to = -1
      for (let i = from; i > to; i += this.step) {
        if (i < 0 || i >= length) break
        out.push({ path: `${node.path}[${i}]`, value: value[i] })
      }
    }
  }
}

/**
 * "Self and every descendant", in pre-order. The selector that follows in
 * the expression is applied to each of these nodes, which is how `$..name`
 * and `$..[0]` both fall out of one segment type.
 */
class RecursiveSegment implements Segment {
  apply(node: JsonPathMatch, out: JsonPathMatch[]): void {
    out.push(node)
    descend(node, out)
  }
}

function descend(node: JsonPathMatch, out: JsonPathMatch[]): void {
  const value = node.value
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      const child: JsonPathMatch = { path: `${node.path}['${key}']`, value: (value as Record<string, unknown>)[key] }
      out.push(child)
      descend(child, out)
    }
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const child: JsonPathMatch = { path: `${node.path}[${i}]`, value: value[i] }
      out.push(child)
      descend(child, out)
    }
  }
}

class FilterSegment implements Segment {
  /** Member chain to follow from each candidate; empty means the node itself. */
  private readonly path: string[]
  /** Comparison operator, or null for an existence test. */
  private readonly op: string | null
  private readonly literal: unknown
  constructor(path: string[], op: string | null, literal: unknown) {
    this.path = path
    this.op = op
    this.literal = literal
  }

  apply(node: JsonPathMatch, out: JsonPathMatch[]): void {
    const value = node.value
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const candidate: JsonPathMatch = { path: `${node.path}[${i}]`, value: value[i] }
        if (this.test(candidate.value)) out.push(candidate)
      }
    } else if (isPlainObject(value)) {
      // Applying a filter to an object's members is a widely-implemented
      // extension; without it "$..[?(@.x)]" would silently miss object nodes.
      for (const key of Object.keys(value)) {
        const candidate: JsonPathMatch = { path: `${node.path}['${key}']`, value: (value as Record<string, unknown>)[key] }
        if (this.test(candidate.value)) out.push(candidate)
      }
    }
  }

  private test(candidate: unknown): boolean {
    let current: unknown = candidate
    let exists = true
    for (const part of this.path) {
      if (isPlainObject(current) && Object.prototype.hasOwnProperty.call(current, part)) {
        current = (current as Record<string, unknown>)[part]
        continue
      }
      if (Array.isArray(current)) {
        const index = parseIntStrict(part)
        if (index !== null) {
          const resolved = index < 0 ? current.length + index : index
          if (resolved >= 0 && resolved < current.length) {
            current = current[resolved]
            continue
          }
        }
      }
      exists = false
      break
    }

    if (this.op === null) return exists && current !== null && current !== undefined
    // A member that does not exist is "Nothing": it equals no literal, so an
    // "!=" test against it holds and every other comparison fails.
    if (!exists) return this.op === '!='
    return compareValues(current, this.literal, this.op)
  }
}

function compareValues(left: unknown, right: unknown, op: string): boolean {
  switch (op) {
    case '==':
      return valuesEqual(left, right)
    case '!=':
      return !valuesEqual(left, right)
  }

  let ordering: number | null = null
  if (typeof left === 'number' && typeof right === 'number') {
    ordering = left < right ? -1 : left > right ? 1 : 0
  } else if (typeof left === 'string' && typeof right === 'string') {
    ordering = left < right ? -1 : left > right ? 1 : 0
  }
  if (ordering === null) return false // Incomparable types never match.

  switch (op) {
    case '<':
      return ordering < 0
    case '<=':
      return ordering <= 0
    case '>':
      return ordering > 0
    case '>=':
      return ordering >= 0
    default:
      return false
  }
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') return left === right
  return left === right
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseIntStrict(text: string): number | null {
  if (!/^-?\d+$/.test(text)) return null
  return parseInt(text, 10)
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseExpression(expression: string): Segment[] {
  let expr = expression
  if (!expr.startsWith('$')) {
    if (expr.startsWith('.') || expr.startsWith('[')) {
      expr = `$${expr}`
    } else {
      throw new JsonPathError('A JSONPath expression must start with "$" (the document root).')
    }
  }

  const segments: Segment[] = []
  let i = 1

  while (i < expr.length) {
    const c = expr[i]

    if (c === '$') {
      throw new JsonPathError('"$" is only valid at the very start of an expression.')
    }

    if (c === '.') {
      if (i + 1 < expr.length && expr[i + 1] === '.') {
        // Recursive descent: "self and all descendants", then whatever
        // selector follows applies to each of those nodes.
        segments.push(new RecursiveSegment())
        i += 2
        if (i >= expr.length) {
          throw new JsonPathError('".." must be followed by a name, "*", or a bracket selector.')
        }
        if (expr[i] === '[') continue // e.g. "$..[0]"
        if (expr[i] === '*') {
          segments.push(new WildcardSegment())
          i++
          continue
        }
        const name = readName(expr, i)
        if (name.length === 0) {
          throw new JsonPathError('".." must be followed by a name, "*", or a bracket selector.')
        }
        segments.push(new ChildSegment(name))
        i += name.length
        continue
      }

      i++
      if (i >= expr.length) {
        throw new JsonPathError('Expression ends with "." — expected a child name or "*" after it.')
      }
      if (expr[i] === '*') {
        segments.push(new WildcardSegment())
        i++
        continue
      }
      const name = readName(expr, i)
      if (name.length === 0) {
        throw new JsonPathError(`Expected a child name after "." at position ${i}.`)
      }
      segments.push(new ChildSegment(name))
      i += name.length
      continue
    }

    if (c === '[') {
      const close = matchingBracket(expr, i)
      if (close < 0) {
        throw new JsonPathError(`Unclosed "[" at position ${i}.`)
      }
      segments.push(parseBracket(expr.substring(i + 1, close).trim()))
      i = close + 1
      continue
    }

    throw new JsonPathError(`Unexpected character "${c}" at position ${i} — expected "." or "[".`)
  }

  if (segments.length > 0 && segments[segments.length - 1] instanceof RecursiveSegment) {
    throw new JsonPathError('".." must be followed by a name, "*", or a bracket selector.')
  }

  return segments
}

function readName(expr: string, start: number): string {
  let end = start
  while (end < expr.length && !".[]()*?@,:'\"".includes(expr[end])) {
    end++
  }
  return expr.substring(start, end)
}

function matchingBracket(expr: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < expr.length; i++) {
    const c = expr[i]
    if (quote !== null) {
      if (c === '\\') {
        i++
      } else if (c === quote) {
        quote = null
      }
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      continue
    }
    if (c === '[') depth++
    if (c === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function parseBracket(body: string): Segment {
  if (body.length === 0) throw new JsonPathError('Empty "[]" selector.')

  if (body === '*') return new WildcardSegment()

  if (body.startsWith('?')) return parseFilter(body)

  if (body.startsWith('(')) {
    throw new JsonPathError('Script expressions "[(...)]" are not supported.')
  }

  if ((body.startsWith("'") && body.endsWith("'") && body.length >= 2) || (body.startsWith('"') && body.endsWith('"') && body.length >= 2)) {
    const inner = body.substring(1, body.length - 1)
    if (inner.includes(body[0])) {
      throw new JsonPathError('Union selectors like "[\'a\',\'b\']" are not supported.')
    }
    return new ChildSegment(inner.replace(/\\\\/g, '\\'))
  }

  if (body.includes(',')) {
    throw new JsonPathError('Union selectors like "[0,1]" or "[\'a\',\'b\']" are not supported.')
  }

  if (body.includes(':')) return parseSlice(body)

  const index = parseIntStrict(body)
  if (index !== null) return new IndexSegment(index)

  throw new JsonPathError(`Unsupported bracket selector "[${body}]".`)
}

function parseSlice(body: string): Segment {
  const parts = body.split(':')
  if (parts.length > 3) {
    throw new JsonPathError(`Slice "[${body}]" has too many ":" separators.`)
  }

  const part = (index: number): number | null => {
    if (index >= parts.length) return null
    const text = parts[index].trim()
    if (text.length === 0) return null
    const value = parseIntStrict(text)
    if (value === null) {
      throw new JsonPathError(`Slice bound "${text}" in "[${body}]" is not an integer.`)
    }
    return value
  }

  const step = part(2) ?? 1
  if (step === 0) throw new JsonPathError('Slice step cannot be 0.')
  return new SliceSegment(part(0), part(1), step)
}

function parseFilter(body: string): Segment {
  // body looks like "?(...)" or, tolerantly, "?...".
  let inner = body.substring(1).trim()
  if (inner.startsWith('(') && inner.endsWith(')')) {
    inner = inner.substring(1, inner.length - 1).trim()
  }
  if (inner.length === 0) throw new JsonPathError('Empty filter expression "[?()]".')

  if (inner.includes('&&') || inner.includes('||')) {
    throw new JsonPathError(
      'Filters combining conditions with "&&" or "||" are not supported — ' +
        'only a single comparison or existence test.',
    )
  }
  if (inner.includes('=~')) {
    throw new JsonPathError('Regex match filters "=~" are not supported.')
  }
  if (inner.startsWith('!')) {
    throw new JsonPathError('Negated filters "[?(!@.x)]" are not supported.')
  }
  if (/\w+\s*\(/.test(inner)) {
    throw new JsonPathError('Filter functions such as length() or match() are not supported.')
  }

  for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
    const at = inner.indexOf(op)
    if (at < 0) continue
    // Skip "<"/">" that are really part of "<=" / ">=", already handled.
    if ((op === '<' || op === '>') && at + 1 < inner.length && inner[at + 1] === '=') continue
    const lhs = inner.substring(0, at).trim()
    const rhs = inner.substring(at + op.length).trim()
    if (lhs.length === 0 || rhs.length === 0) {
      throw new JsonPathError(`Filter "${inner}" is missing an operand around "${op}".`)
    }
    return new FilterSegment(parseFilterPath(lhs), op, parseLiteral(rhs))
  }

  if (inner.includes('=')) {
    throw new JsonPathError('Use "==" for equality in a filter, not "=".')
  }

  // Existence test.
  return new FilterSegment(parseFilterPath(inner), null, null)
}

/**
 * `@`, `@.a.b`, `@['a']['b']` -> the member chain to follow from each
 * candidate node. An empty list means the node itself.
 */
function parseFilterPath(text: string): string[] {
  let expr = text.trim()
  if (!expr.startsWith('@')) {
    throw new JsonPathError(`Filter operand "${text}" must start with "@" (the current node).`)
  }
  expr = expr.substring(1)

  const parts: string[] = []
  let i = 0
  while (i < expr.length) {
    if (expr[i] === '.') {
      i++
      const name = readName(expr, i)
      if (name.length === 0) throw new JsonPathError(`Filter operand "${text}" has an empty member name.`)
      parts.push(name)
      i += name.length
      continue
    }
    if (expr[i] === '[') {
      const close = matchingBracket(expr, i)
      if (close < 0) throw new JsonPathError(`Filter operand "${text}" has an unclosed "[".`)
      let inner = expr.substring(i + 1, close).trim()
      if ((inner.startsWith("'") && inner.endsWith("'")) || (inner.startsWith('"') && inner.endsWith('"'))) {
        inner = inner.substring(1, inner.length - 1)
      }
      if (inner.length === 0) throw new JsonPathError(`Filter operand "${text}" has an empty "[]".`)
      parts.push(inner)
      i = close + 1
      continue
    }
    throw new JsonPathError(`Unsupported filter operand "${text}".`)
  }
  return parts
}

function parseLiteral(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.startsWith('@')) {
    throw new JsonPathError('Filters comparing two "@" paths are not supported — compare against a literal.')
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)
  ) {
    return trimmed.substring(1, trimmed.length - 1)
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
    return Number(trimmed)
  }
  throw new JsonPathError(`Filter literal "${trimmed}" is not a number, quoted string, true, false, or null.`)
}
