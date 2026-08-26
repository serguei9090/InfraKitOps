import type { IToolUseCase } from '../ports/IToolUseCase'

/** Target naming convention for `TextCaseConverter`. */
export type TextCase =
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'screamingSnake'
  | 'kebab'
  | 'train'
  | 'dot'
  | 'title'
  | 'sentence'
  | 'lower'
  | 'upper'

export const TEXT_CASES: TextCase[] = [
  'camel',
  'pascal',
  'snake',
  'screamingSnake',
  'kebab',
  'train',
  'dot',
  'title',
  'sentence',
  'lower',
  'upper',
]

export const TEXT_CASE_META: Record<TextCase, { label: string; example: string }> = {
  camel: { label: 'camelCase', example: 'userNameId' },
  pascal: { label: 'PascalCase', example: 'UserNameId' },
  snake: { label: 'snake_case', example: 'user_name_id' },
  screamingSnake: { label: 'SCREAMING_SNAKE_CASE', example: 'USER_NAME_ID' },
  kebab: { label: 'kebab-case', example: 'user-name-id' },
  train: { label: 'Train-Case', example: 'User-Name-Id' },
  dot: { label: 'dot.case', example: 'user.name.id' },
  title: { label: 'Title Case', example: 'User Name Id' },
  sentence: { label: 'Sentence case', example: 'User name id' },
  lower: { label: 'lowercase', example: 'user name id' },
  upper: { label: 'UPPERCASE', example: 'USER NAME ID' },
}

/**
 * `lower` and `upper` deliberately keep the original punctuation and spacing
 * instead of re-joining split words, so they can be used to down/up-case a
 * whole paragraph.
 */
export function textCasePreservesLayout(target: TextCase): boolean {
  return target === 'lower' || target === 'upper'
}

/**
 * The line-oriented operations, kept in one union so the UI can build a
 * single "Lines" group in its operation picker.
 */
export type LineOperation = 'sort' | 'deduplicate' | 'reverse' | 'trim' | 'removeBlank' | 'number'

export const LINE_OPERATIONS: LineOperation[] = ['sort', 'deduplicate', 'reverse', 'trim', 'removeBlank', 'number']

export const LINE_OPERATION_LABELS: Record<LineOperation, string> = {
  sort: 'Sort lines',
  deduplicate: 'Remove duplicate lines',
  reverse: 'Reverse line order',
  trim: 'Trim each line',
  removeBlank: 'Remove blank lines',
  number: 'Add line numbers',
}

export interface TextTransformResult {
  output: string
  /** Number of lines in `output` (0 for empty output). */
  lineCount: number
}

function resultOf(output: string): TextTransformResult {
  return { output, lineCount: output.length === 0 ? 0 : output.split('\n').length }
}

export interface TextCaseInput {
  text: string
  target: TextCase
}

export interface SlugifyInput {
  text: string
  /**
   * Character(s) that replace runs of non-alphanumerics. `-` for URLs, `_`
   * for filenames.
   */
  separator?: string
  lowercase?: boolean
  /**
   * Truncate the slug at this many characters, cutting at a separator
   * boundary so no half-word is left behind. Undefined means no limit.
   */
  maxLength?: number
}

export interface LineOperationInput {
  text: string
  operation: LineOperation
  /** `sort` only. */
  descending?: boolean
  /** `sort` and `deduplicate`. */
  caseInsensitive?: boolean
  /** `sort` only — compare embedded digit runs numerically so `item2` sorts before `item10`. */
  natural?: boolean
  /** `number` only. */
  startNumber?: number
  numberSeparator?: string
  /** `number` only — right-align numbers so the text stays in one column past line 9. */
  padNumbers?: boolean
}

/** Splits identifiers/prose into words, then re-joins them in a target naming convention. */
export class TextCaseConverter implements IToolUseCase<TextCaseInput, TextTransformResult> {
  execute(input: TextCaseInput): TextTransformResult {
    return resultOf(this.convert(input.text, input.target))
  }

  convert(text: string, target: TextCase): string {
    if (target === 'lower') return text.toLowerCase()
    if (target === 'upper') return text.toUpperCase()

    const words = TextCaseConverter.splitWords(text)
    if (words.length === 0) return ''

    switch (target) {
      case 'camel':
        return [lower(words[0]), ...words.slice(1).map(capitalize)].join('')
      case 'pascal':
        return words.map(capitalize).join('')
      case 'snake':
        return words.map(lower).join('_')
      case 'screamingSnake':
        return words.map(upper).join('_')
      case 'kebab':
        return words.map(lower).join('-')
      case 'train':
        return words.map(capitalize).join('-')
      case 'dot':
        return words.map(lower).join('.')
      case 'title':
        return words.map(capitalize).join(' ')
      case 'sentence':
        return [capitalize(words[0]), ...words.slice(1).map(lower)].join(' ')
    }
  }

  /**
   * Breaks `text` into words on separators, case boundaries and digit
   * boundaries.
   *
   * Separators are any ASCII character that is not a letter or digit, so
   * `_ - . / space` and punctuation all split. Case boundaries handle both
   * `fooBar` -> `foo|Bar` and the acronym case `XMLHttpRequest` ->
   * `XML|Http|Request`, which is where naive `toLowerCase()`-then-split
   * implementations fall over. Digits become their own words, so
   * `parseHTTP2Response` -> `parse|HTTP|2|Response`.
   *
   * Non-ASCII characters (accented letters, CJK, ...) are treated as word
   * characters and never split on, since their case rules are not reliably
   * detectable here — `TextSlugifier` handles folding them.
   */
  static splitWords(text: string): string[] {
    const words: string[] = []
    let buffer = ''

    const flush = () => {
      if (buffer.length > 0) {
        words.push(buffer)
        buffer = ''
      }
    }

    for (let i = 0; i < text.length; i++) {
      const unit = text.charCodeAt(i)
      if (isSeparatorUnit(unit)) {
        flush()
        continue
      }
      if (buffer.length === 0) {
        buffer += text[i]
        continue
      }

      const previous = text.charCodeAt(i - 1)
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : null

      const digitBoundary = isDigitUnit(unit) !== isDigitUnit(previous)
      const lowerToUpper = isUpperUnit(unit) && !isUpperUnit(previous) && !isDigitUnit(previous)
      const acronymEnd = isUpperUnit(unit) && isUpperUnit(previous) && next !== null && isLowerUnit(next)

      if (digitBoundary || lowerToUpper || acronymEnd) flush()
      buffer += text[i]
    }

    flush()
    return words
  }
}

function isSeparatorUnit(unit: number): boolean {
  if (unit > 127) return false // keep accented/CJK characters in the word
  return !isDigitUnit(unit) && !isUpperUnit(unit) && !isLowerUnit(unit)
}

function isDigitUnit(unit: number): boolean {
  return unit >= 0x30 && unit <= 0x39
}

function isUpperUnit(unit: number): boolean {
  return unit >= 0x41 && unit <= 0x5a
}

function isLowerUnit(unit: number): boolean {
  return unit >= 0x61 && unit <= 0x7a
}

function lower(word: string): string {
  return word.toLowerCase()
}

function upper(word: string): string {
  return word.toUpperCase()
}

function capitalize(word: string): string {
  if (word.length === 0) return word
  return word[0].toUpperCase() + word.substring(1).toLowerCase()
}

/**
 * URL/filename slugs: fold diacritics, drop everything that is not
 * alphanumeric, collapse and trim the separator.
 */
export class TextSlugifier implements IToolUseCase<SlugifyInput, TextTransformResult> {
  execute(input: SlugifyInput): TextTransformResult {
    return resultOf(
      this.slugify(input.text, {
        separator: input.separator ?? '-',
        lowercase: input.lowercase ?? true,
        maxLength: input.maxLength,
      }),
    )
  }

  slugify(
    text: string,
    options: { separator?: string; lowercase?: boolean; maxLength?: number } = {},
  ): string {
    const separator = options.separator ?? '-'
    const lowercase = options.lowercase ?? true
    const maxLength = options.maxLength

    if (maxLength !== undefined && maxLength < 1) {
      throw new Error('Maximum length must be at least 1')
    }

    let working = TextSlugifier.foldDiacritics(text)
    if (lowercase) working = working.toLowerCase()

    let out = ''
    let pendingSeparator = false
    let wroteAny = false

    for (let i = 0; i < working.length; i++) {
      const unit = working.charCodeAt(i)
      const isWordChar = (unit >= 0x30 && unit <= 0x39) || (unit >= 0x41 && unit <= 0x5a) || (unit >= 0x61 && unit <= 0x7a)
      if (isWordChar) {
        // Collapse the run of separators and never emit a leading one.
        if (pendingSeparator && wroteAny) out += separator
        pendingSeparator = false
        out += working[i]
        wroteAny = true
      } else {
        pendingSeparator = true
      }
    }

    let slug = out
    if (maxLength !== undefined && slug.length > maxLength) {
      slug = slug.substring(0, maxLength)
      if (separator.length > 0) {
        const cut = slug.lastIndexOf(separator)
        if (cut > 0) slug = slug.substring(0, cut)
        // Trim a separator left dangling by the hard cut.
        while (slug.endsWith(separator)) {
          slug = slug.substring(0, slug.length - separator.length)
        }
      }
    }
    return slug
  }

  /**
   * Replaces Latin letters carrying diacritics with their ASCII base, plus
   * the handful of ligatures/letters that expand to two characters (ß->ss,
   * æ->ae, þ->th). JS has no built-in table for this, so it's an explicit
   * lookup rather than a Unicode-normalisation strip.
   */
  static foldDiacritics(text: string): string {
    let out = ''
    for (const char of text) {
      const codePoint = char.codePointAt(0) ?? 0
      if (codePoint < 0x80) {
        out += char
        continue
      }
      out += DIACRITICS.get(char) ?? char
    }
    return out
  }
}

const DIACRITICS: Map<string, string> = buildDiacriticTable()

function buildDiacriticTable(): Map<string, string> {
  const groups: Record<string, string> = {
    a: 'àáâãäåāăą',
    A: 'ÀÁÂÃÄÅĀĂĄ',
    c: 'çćĉċč',
    C: 'ÇĆĈĊČ',
    d: 'ďđ',
    D: 'ĎĐ',
    e: 'èéêëēĕėęě',
    E: 'ÈÉÊËĒĔĖĘĚ',
    g: 'ĝğġģ',
    G: 'ĜĞĠĢ',
    h: 'ĥħ',
    H: 'ĤĦ',
    i: 'ìíîïĩīĭįı',
    I: 'ÌÍÎÏĨĪĬĮİ',
    j: 'ĵ',
    J: 'Ĵ',
    k: 'ķ',
    K: 'Ķ',
    l: 'ĺļľŀł',
    L: 'ĹĻĽĿŁ',
    n: 'ñńņňŉ',
    N: 'ÑŃŅŇ',
    o: 'òóôõöøōŏő',
    O: 'ÒÓÔÕÖØŌŎŐ',
    r: 'ŕŗř',
    R: 'ŔŖŘ',
    s: 'śŝşš',
    S: 'ŚŜŞŠ',
    t: 'ţťŧ',
    T: 'ŢŤŦ',
    u: 'ùúûüũūŭůűų',
    U: 'ÙÚÛÜŨŪŬŮŰŲ',
    w: 'ŵ',
    W: 'Ŵ',
    y: 'ýÿŷ',
    Y: 'ÝŶŸ',
    z: 'źżž',
    Z: 'ŹŻŽ',
    ae: 'æ',
    AE: 'Æ',
    oe: 'œ',
    OE: 'Œ',
    ss: 'ß',
    th: 'þ',
    TH: 'Þ',
    dh: 'ð',
    DH: 'Ð',
  }
  const table = new Map<string, string>()
  for (const [replacement, accented] of Object.entries(groups)) {
    for (const char of accented) {
      table.set(char, replacement)
    }
  }
  return table
}

/** Sort / dedupe / reverse / trim / de-blank / number, over the lines of a block of text. */
export class LineOperationRunner implements IToolUseCase<LineOperationInput, TextTransformResult> {
  execute(input: LineOperationInput): TextTransformResult {
    const lines = LineOperationRunner.splitLines(input.text)
    if (lines.length === 0) return { output: '', lineCount: 0 }

    let result: string[]
    switch (input.operation) {
      case 'sort':
        result = this.sort(lines, {
          descending: input.descending ?? false,
          caseInsensitive: input.caseInsensitive ?? false,
          natural: input.natural ?? false,
        })
        break
      case 'deduplicate':
        result = this.deduplicate(lines, input.caseInsensitive ?? false)
        break
      case 'reverse':
        result = [...lines].reverse()
        break
      case 'trim':
        result = lines.map((line) => line.trim())
        break
      case 'removeBlank':
        result = lines.filter((line) => line.trim().length > 0)
        break
      case 'number':
        result = this.number(lines, {
          start: input.startNumber ?? 1,
          separator: input.numberSeparator ?? '. ',
          pad: input.padNumbers ?? true,
        })
        break
    }

    return { output: result.join('\n'), lineCount: result.length }
  }

  /**
   * Splits on CRLF/CR/LF and drops a single trailing empty line so a text
   * block ending in a newline does not gain a phantom row.
   */
  static splitLines(text: string): string[] {
    if (text.length === 0) return []
    const lines = text.split(/\r\n|\r|\n/)
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return lines
  }

  sort(lines: string[], options: { descending: boolean; caseInsensitive: boolean; natural: boolean }): string[] {
    const sorted = [...lines]
    const compare = (a: string, b: string): number => {
      const left = options.caseInsensitive ? a.toLowerCase() : a
      const right = options.caseInsensitive ? b.toLowerCase() : b
      const result = options.natural ? LineOperationRunner.compareNatural(left, right) : left < right ? -1 : left > right ? 1 : 0
      // Fall back to the exact strings so a case-insensitive sort is still
      // deterministic for lines that differ only in case.
      return result !== 0 ? result : a < b ? -1 : a > b ? 1 : 0
    }

    sorted.sort(compare)
    return options.descending ? sorted.reverse() : sorted
  }

  /** Keeps the first occurrence of each line and drops later repeats. */
  deduplicate(lines: string[], caseInsensitive: boolean): string[] {
    const seen = new Set<string>()
    const result: string[] = []
    for (const line of lines) {
      const key = caseInsensitive ? line.toLowerCase() : line
      if (!seen.has(key)) {
        seen.add(key)
        result.push(line)
      }
    }
    return result
  }

  number(lines: string[], options: { start: number; separator: string; pad: boolean }): string[] {
    const width = options.pad ? `${options.start + lines.length - 1}`.length : 0
    return lines.map((line, i) => `${`${options.start + i}`.padStart(width)}${options.separator}${line}`)
  }

  /**
   * "Natural" comparison: runs of digits compare as numbers, so `item2`
   * comes before `item10`. Leading zeros do not change the value, only the
   * tie-break.
   */
  static compareNatural(a: string, b: string): number {
    let i = 0
    let j = 0
    while (i < a.length && j < b.length) {
      const aDigit = isDigit(a.charCodeAt(i))
      const bDigit = isDigit(b.charCodeAt(j))

      if (aDigit && bDigit) {
        const aStart = i
        const bStart = j
        while (i < a.length && isDigit(a.charCodeAt(i))) {
          i++
        }
        while (j < b.length && isDigit(b.charCodeAt(j))) {
          j++
        }
        const aRun = a.substring(aStart, i)
        const bRun = b.substring(bStart, j)
        const aTrimmed = aRun.replace(/^0+(?=\d)/, '')
        const bTrimmed = bRun.replace(/^0+(?=\d)/, '')
        if (aTrimmed.length !== bTrimmed.length) {
          return aTrimmed.length - bTrimmed.length
        }
        const digits = aTrimmed < bTrimmed ? -1 : aTrimmed > bTrimmed ? 1 : 0
        if (digits !== 0) return digits
        // Same numeric value: shorter (fewer leading zeros) sorts first.
        if (aRun.length !== bRun.length) return aRun.length - bRun.length
        continue
      }

      const charComparison = a.charCodeAt(i) - b.charCodeAt(j)
      if (charComparison !== 0) return charComparison
      i++
      j++
    }
    return a.length - i - (b.length - j)
  }
}

function isDigit(unit: number): boolean {
  return unit >= 0x30 && unit <= 0x39
}

/**
 * One entry point the UI can hold, so the four screens' worth of small
 * spec 2.5 items live behind a single object.
 */
export class TextTransformer {
  private readonly caseConverter = new TextCaseConverter()
  private readonly slugifier = new TextSlugifier()
  private readonly lineRunner = new LineOperationRunner()

  convertCase(text: string, target: TextCase): TextTransformResult {
    return this.caseConverter.execute({ text, target })
  }

  slugify(text: string, options: { separator?: string; lowercase?: boolean; maxLength?: number } = {}): TextTransformResult {
    return this.slugifier.execute({ text, ...options })
  }

  runLineOperation(input: LineOperationInput): TextTransformResult {
    return this.lineRunner.execute(input)
  }
}
