import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Where a capture group's value came from.
 *
 * JS's `RegExpMatchArray` exposes group *values* but not group *offsets*, so
 * a capture group can report its text but not its position in the subject.
 * Only the overall match carries `RegexMatchResult.start`/`end`.
 */
export interface RegexCaptureGroup {
  /** 1-based group number. Group 0 (the whole match) is not repeated here. */
  index: number
  /** The group's name when the pattern used `(?<name>...)`, otherwise undefined. */
  name?: string
  /** The captured text, or undefined when the group did not participate in the match. */
  value?: string
}

export function didParticipate(group: RegexCaptureGroup): boolean {
  return group.value !== undefined
}

/** `1` or `1 (year)` — the label the UI shows for this group. */
export function groupLabel(group: RegexCaptureGroup): string {
  return group.name === undefined ? `${group.index}` : `${group.index} (${group.name})`
}

export interface RegexMatchResult {
  /** 0-based position of this match within the list of all matches. */
  index: number
  /** Inclusive start offset of the match in the subject string. */
  start: number
  /** Exclusive end offset of the match in the subject string. */
  end: number
  /** The full matched substring (group 0). */
  text: string
  /**
   * Every capture group the pattern declares, numbered and (where the
   * pattern names them) named. Groups that did not participate are included
   * with an undefined `value` — a missing group is usually the thing being
   * debugged, so it is reported rather than dropped.
   */
  groups: RegexCaptureGroup[]
}

export function namedGroups(match: RegexMatchResult): RegexCaptureGroup[] {
  return match.groups.filter((g) => g.name !== undefined)
}

/** One decomposed piece of the pattern, described in English. */
export interface RegexExplanationToken {
  /** The literal slice of the pattern this token covers. */
  token: string
  /** A plain-English description of what that slice does. */
  description: string
  /** Group nesting level, so the UI can indent nested constructs. */
  depth: number
}

export interface RegexTesterInput {
  pattern: string
  subject: string
  /** `i` — letters match regardless of case. */
  caseInsensitive?: boolean
  /** `m` — `^` and `$` match at line breaks, not just string boundaries. */
  multiLine?: boolean
  /** `s` — `.` also matches newline characters. */
  dotAll?: boolean
  /**
   * `u` — full Unicode code-point semantics (a surrogate pair counts as one
   * character) and `\u{...}` escapes.
   */
  unicode?: boolean
}

/**
 * The flag letters in canonical order, e.g. `gim`. `g` is implicit because
 * this tool always reports every match.
 */
export function flagString(input: RegexTesterInput): string {
  let s = 'g'
  if (input.caseInsensitive) s += 'i'
  if (input.multiLine) s += 'm'
  if (input.dotAll) s += 's'
  if (input.unicode) s += 'u'
  return s
}

export interface RegexTesterResult {
  isValid: boolean
  errorMessage?: string
  /** Every match found, in subject order, capped at `RegexTester.maxMatches`. */
  matches: RegexMatchResult[]
  /**
   * Token-by-token decomposition of the pattern. Populated whenever the
   * pattern is syntactically valid, even when there are zero matches.
   */
  explanation: RegexExplanationToken[]
  /**
   * Non-fatal advisories (e.g. a nested quantifier that risks catastrophic
   * backtracking, or an input that hit a cap).
   */
  warnings: string[]
  /**
   * True when the subject was longer than `RegexTester.maxSubjectLength` and
   * was cut down before matching.
   */
  subjectTruncated: boolean
  /** True when matching stopped at `RegexTester.maxMatches`. */
  matchesTruncated: boolean
}

export function matchCount(result: RegexTesterResult): number {
  return result.matches.length
}

/**
 * Runs a regular expression against a subject string and decomposes the
 * pattern into an English explanation.
 *
 * ## Safety caps
 *
 * A pattern with nested quantifiers such as `(a+)+$` backtracks
 * exponentially. The only real defence is bounding the work:
 *
 * - the subject is truncated to `maxSubjectLength` (20,000 characters) and
 *   `subjectTruncated` is set;
 * - at most `maxMatches` (1,000) matches are collected, after which
 *   `matchesTruncated` is set;
 * - `nestedQuantifierWarning` is emitted when the pattern *looks* like it
 *   contains a quantified group that is itself quantified.
 *
 * Be honest about the limit: a truly pathological pattern can still take a
 * long time against a 20,000-character subject. The caps bound the damage
 * and the warning tells the user what they are about to do; they do not
 * make catastrophic backtracking impossible.
 *
 * ## Dart -> JS RegExp divergences worth flagging
 *
 * - JS strings (like Dart strings) are UTF-16 code-unit sequences, so
 *   offsets/lengths and the `unicode` ("full code point") flag behavior
 *   line up directly between the two engines — a surrogate pair counts as
 *   length 2 without `u`, length 1 with `u`, in both.
 * - Named capturing groups: JS also numbers named groups left-to-right
 *   alongside unnamed ones (`match.length - 1` is the total capturing-group
 *   count), so the same value-matching heuristic Dart's test suite exercises
 *   maps directly.
 * - `\p{...}` Unicode property escapes and named backreferences `\k<name>`
 *   are only meaningful to the JS engine under the `u` flag; without it they
 *   degrade to literal character matches rather than erroring, which can
 *   differ from Dart/ICU's regex engine. This only affects *matching*
 *   behavior for those specific constructs when `unicode` is left off — the
 *   pattern explainer describes them the same regardless.
 *
 * ## What the explainer does *not* do
 *
 * `explain` is a single-pass token scanner, not a regex grammar/parser. It
 * covers the constructs in the app's regex cheatsheet — character classes
 * and `\d \D \w \W \s \S`, `[...]` sets, anchors `^ $ \b \B`, quantifiers
 * `* + ? {n,m}` including their lazy `?` forms, groups `(...)`, `(?:...)`,
 * `(?<name>...)`, alternation `|`, lookaround `(?=)`, `(?!)`, `(?<=)`,
 * `(?<!)`, backreferences `\1` / `\k<name>`, and escaped literals. It
 * deliberately does not:
 *
 * - build a tree or verify that groups balance (an unbalanced `)` is
 *   described as a group close, and the *matching* step is what reports
 *   the syntax error);
 * - resolve which sub-expression a quantifier applies to beyond "the
 *   preceding element";
 * - interpret the contents of a character class beyond listing its ranges
 *   and members, or expand `\p{...}` Unicode property escapes;
 * - describe conditionals, atomic groups, or recursion.
 */
export class RegexTester implements IToolUseCase<RegexTesterInput, RegexTesterResult> {
  /** Subject strings longer than this are truncated before matching. */
  static readonly maxSubjectLength = 20000

  /** Matching stops after this many matches. */
  static readonly maxMatches = 1000

  static readonly nestedQuantifierWarning =
    'This pattern contains a quantified group that is itself quantified ' +
    '(e.g. "(a+)+"). Patterns shaped like this can backtrack exponentially ' +
    'and take a very long time on a non-matching subject.'

  execute(input: RegexTesterInput): RegexTesterResult {
    if (input.pattern.length === 0) {
      return emptyResult(false, 'Enter a pattern to test.')
    }

    let regExp: RegExp
    try {
      regExp = new RegExp(input.pattern, flagString(input))
    } catch (e) {
      return {
        isValid: false,
        errorMessage: `Invalid pattern: ${(e as Error).message}`,
        matches: [],
        explanation: this.explain(input.pattern),
        warnings: [],
        subjectTruncated: false,
        matchesTruncated: false,
      }
    }

    const warnings: string[] = []
    if (hasNestedQuantifier(input.pattern)) warnings.push(RegexTester.nestedQuantifierWarning)

    let subject = input.subject
    let subjectTruncated = false
    if (subject.length > RegexTester.maxSubjectLength) {
      subject = subject.substring(0, RegexTester.maxSubjectLength)
      subjectTruncated = true
      warnings.push(
        `Subject truncated to ${RegexTester.maxSubjectLength} characters ` +
          `(was ${input.subject.length}) to keep matching responsive.`,
      )
    }

    const matches: RegexMatchResult[] = []
    let matchesTruncated = false
    try {
      for (const match of subject.matchAll(regExp)) {
        if (matches.length >= RegexTester.maxMatches) {
          matchesTruncated = true
          break
        }
        matches.push(toResult(matches.length, match))
      }
    } catch (e) {
      return {
        isValid: false,
        errorMessage: `Matching failed: ${(e as Error).message}`,
        matches: [],
        explanation: this.explain(input.pattern),
        warnings,
        subjectTruncated,
        matchesTruncated: false,
      }
    }

    if (matchesTruncated) {
      warnings.push(`Stopped after the first ${RegexTester.maxMatches} matches.`)
    }

    return {
      isValid: true,
      matches,
      explanation: this.explain(input.pattern),
      warnings,
      subjectTruncated,
      matchesTruncated,
    }
  }

  /**
   * Decompose `pattern` into tokens with an English description each. See
   * the class doc for the constructs this covers and the ones it does not.
   */
  explain(pattern: string): RegexExplanationToken[] {
    const tokens: RegexExplanationToken[] = []
    let depth = 0
    let groupNumber = 0
    let i = 0
    let literal = ''

    const flushLiteral = (keepLastChar = false) => {
      if (literal.length === 0) return
      let text = literal
      literal = ''
      if (keepLastChar && text.length > 1) {
        const head = text.substring(0, text.length - 1)
        tokens.push({ token: head, description: `Matches the literal text "${head}".`, depth })
        text = text.substring(text.length - 1)
      }
      tokens.push({
        token: text,
        description:
          text.length === 1
            ? `Matches the literal character "${text}".`
            : `Matches the literal text "${text}".`,
        depth,
      })
    }

    const nextIsQuantifier = (): boolean => {
      if (i + 1 >= pattern.length) return false
      const c = pattern[i + 1]
      return c === '*' || c === '+' || c === '?' || (c === '{' && braceQuantifierEnd(pattern, i + 1) > 0)
    }

    const add = (token: string, description: string, atDepth?: number) => {
      tokens.push({ token, description, depth: atDepth ?? depth })
    }

    while (i < pattern.length) {
      const c = pattern[i]

      switch (c) {
        case '\\': {
          flushLiteral(false)
          const [consumed, tok, desc] = escapeToken(pattern, i)
          i += consumed
          add(tok, desc)
          continue
        }

        case '[': {
          flushLiteral()
          const end = endOfClass(pattern, i)
          if (end < 0) {
            add(pattern.substring(i), 'Unterminated character class — missing a closing "]".')
            i = pattern.length
            continue
          }
          const token = pattern.substring(i, end + 1)
          add(token, describeCharacterClass(pattern.substring(i + 1, end)))
          i = end + 1
          continue
        }

        case '(': {
          flushLiteral()
          const [token, kind, extra] = groupOpener(pattern, i)
          let description: string
          if (kind === 'capturing') {
            groupNumber++
            description = `Start of capturing group ${groupNumber} — the text it matches is stored as group ${groupNumber}.`
          } else if (kind === 'named') {
            groupNumber++
            description = `Start of named capturing group "${extra}" (also group ${groupNumber}) — its match is retrievable by name.`
          } else {
            description = extra
          }
          add(token, description)
          depth++
          i += token.length
          continue
        }

        case ')': {
          flushLiteral()
          if (depth > 0) depth--
          add(')', 'End of the group opened above.')
          i++
          continue
        }

        case '|': {
          flushLiteral()
          add('|', 'Alternation — matches either the expression before this or the one after it.')
          i++
          continue
        }

        case '^': {
          flushLiteral()
          add('^', 'Anchor: start of the string (start of a line when multiline mode is on).')
          i++
          continue
        }

        case '$': {
          flushLiteral()
          add('$', 'Anchor: end of the string (end of a line when multiline mode is on).')
          i++
          continue
        }

        case '.': {
          flushLiteral()
          add('.', 'Matches any single character except a line break (any character at all when dotAll is on).')
          i++
          continue
        }

        case '*':
        case '+':
        case '?': {
          flushLiteral()
          const lazy = i + 1 < pattern.length && pattern[i + 1] === '?'
          const token = lazy ? `${c}?` : c
          add(token, describeQuantifier(c, lazy))
          i += token.length
          continue
        }

        case '{': {
          const end = braceQuantifierEnd(pattern, i)
          if (end < 0) {
            // Not a quantifier — a literal brace.
            literal += c
            i++
            continue
          }
          flushLiteral()
          const lazy = end + 1 < pattern.length && pattern[end + 1] === '?'
          const token = pattern.substring(i, lazy ? end + 2 : end + 1)
          add(token, describeBraceQuantifier(pattern.substring(i + 1, end), lazy))
          i = lazy ? end + 2 : end + 1
          continue
        }

        default: {
          // A literal run; if a quantifier follows, split the last character
          // off so the explanation reads "b" then "one or more times".
          literal += c
          if (nextIsQuantifier()) flushLiteral(true)
          i++
          continue
        }
      }
    }
    flushLiteral()
    return tokens
  }
}

function emptyResult(isValid: boolean, errorMessage?: string): RegexTesterResult {
  return {
    isValid,
    errorMessage,
    matches: [],
    explanation: [],
    warnings: [],
    subjectTruncated: false,
    matchesTruncated: false,
  }
}

function toResult(index: number, match: RegExpMatchArray): RegexMatchResult {
  const groupCount = match.length - 1
  const matchGroups = match.groups ?? {}

  // Map group number -> name, so a named group is reported once with both.
  const namesByNumber = new Map<number, string>()
  for (const name of Object.keys(matchGroups)) {
    const value = matchGroups[name]
    for (let i = 1; i <= groupCount; i++) {
      if (namesByNumber.has(i)) continue
      if (match[i] === value) {
        namesByNumber.set(i, name)
        break
      }
    }
  }

  const groups: RegexCaptureGroup[] = []
  for (let i = 1; i <= groupCount; i++) {
    groups.push({ index: i, name: namesByNumber.get(i), value: match[i] })
  }

  // Named groups whose number could not be resolved by value matching (two
  // groups capturing identical text, for instance) are still reported.
  for (const name of Object.keys(matchGroups)) {
    if (groups.some((g) => g.name === name)) continue
    groups.push({ index: groups.length + 1, name, value: matchGroups[name] })
  }

  return {
    index,
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    text: match[0] ?? '',
    groups,
  }
}

/**
 * Heuristic scan for `(...+)+` / `(...*)*` shapes — a quantifier applied to
 * a group whose body already ends in a quantifier. False positives are
 * possible (the result is a warning, never an error).
 */
function hasNestedQuantifier(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== '(') continue
    const close = matchingParen(pattern, i)
    if (close < 0) continue
    const after = close + 1
    if (after >= pattern.length) continue
    const outer = pattern[after]
    if (outer !== '*' && outer !== '+' && !(outer === '{' && pattern.indexOf('}', after) > after)) {
      continue
    }
    // Body must itself contain an unbounded quantifier.
    const body = pattern.substring(i + 1, close)
    for (let j = 0; j < body.length; j++) {
      if (body[j] === '\\') {
        j++
        continue
      }
      if (body[j] === '*' || body[j] === '+') return true
    }
  }
  return false
}

function matchingParen(pattern: string, open: number): number {
  let depth = 0
  for (let i = open; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '[') {
      i = endOfClass(pattern, i)
      if (i < 0) return -1
      continue
    }
    if (c === '(') depth++
    if (c === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function endOfClass(pattern: string, open: number): number {
  for (let i = open + 1; i < pattern.length; i++) {
    if (pattern[i] === '\\') {
      i++
      continue
    }
    if (pattern[i] === ']' && i > open + 1) return i
    if (pattern[i] === ']' && i === open + 1) continue // "[]]" edge case
  }
  return -1
}

/** Returns [charactersConsumed, tokenText, description] for the escape at `i`. */
function escapeToken(pattern: string, i: number): [number, string, string] {
  if (i + 1 >= pattern.length) {
    return [1, '\\', 'A trailing backslash with nothing to escape.']
  }
  const c = pattern[i + 1]
  const token = `\\${c}`

  switch (c) {
    case 'd':
      return [2, token, 'Matches any digit, 0-9.']
    case 'D':
      return [2, token, 'Matches any character that is not a digit.']
    case 'w':
      return [2, token, 'Matches a word character: a letter, digit, or underscore.']
    case 'W':
      return [2, token, 'Matches any character that is not a word character.']
    case 's':
      return [2, token, 'Matches any whitespace character: space, tab, or line break.']
    case 'S':
      return [2, token, 'Matches any non-whitespace character.']
    case 'b':
      return [2, token, 'Word boundary: the position between a word character and a non-word character.']
    case 'B':
      return [2, token, 'Not a word boundary: any position that is not a word boundary.']
    case 'n':
      return [2, token, 'Matches a newline character.']
    case 'r':
      return [2, token, 'Matches a carriage return.']
    case 't':
      return [2, token, 'Matches a tab character.']
    case 'f':
      return [2, token, 'Matches a form feed.']
    case 'v':
      return [2, token, 'Matches a vertical tab.']
    case '0':
      return [2, token, 'Matches a NUL character.']
    case 'k': {
      if (i + 2 < pattern.length && pattern[i + 2] === '<') {
        const close = pattern.indexOf('>', i + 3)
        if (close > 0) {
          const name = pattern.substring(i + 3, close)
          return [
            close - i + 1,
            pattern.substring(i, close + 1),
            `Backreference: matches the same text that named group "${name}" captured.`,
          ]
        }
      }
      return [2, token, 'Escaped "k".']
    }
    case 'u': {
      if (i + 2 < pattern.length && pattern[i + 2] === '{') {
        const close = pattern.indexOf('}', i + 3)
        if (close > 0) {
          const hex = pattern.substring(i + 3, close)
          return [
            close - i + 1,
            pattern.substring(i, close + 1),
            `Matches the Unicode code point U+${hex.toUpperCase()} (requires unicode mode).`,
          ]
        }
      }
      if (i + 5 < pattern.length) {
        const hex = pattern.substring(i + 2, i + 6)
        return [6, pattern.substring(i, i + 6), `Matches the Unicode code unit U+${hex.toUpperCase()}.`]
      }
      return [2, token, 'Unicode escape (incomplete).']
    }
    case 'x': {
      if (i + 3 < pattern.length) {
        const hex = pattern.substring(i + 2, i + 4)
        return [4, pattern.substring(i, i + 4), `Matches the character with hex code 0x${hex.toUpperCase()}.`]
      }
      return [2, token, 'Hex escape (incomplete).']
    }
    case 'p':
    case 'P': {
      if (i + 2 < pattern.length && pattern[i + 2] === '{') {
        const close = pattern.indexOf('}', i + 3)
        if (close > 0) {
          const prop = pattern.substring(i + 3, close)
          const negated = c === 'P' ? 'not ' : ''
          return [
            close - i + 1,
            pattern.substring(i, close + 1),
            `Matches any character ${negated}in the Unicode property "${prop}" (requires unicode mode). ` +
              'The property itself is not decomposed further.',
          ]
        }
      }
      return [2, token, 'Unicode property escape (incomplete).']
    }
    default:
      if (/[1-9]/.test(c)) {
        return [2, token, `Backreference: matches the same text that capturing group ${c} captured.`]
      }
      return [2, token, `Matches a literal "${c}" (the backslash removes any special meaning).`]
  }
}

function describeQuantifier(c: string, lazy: boolean): string {
  const base =
    c === '*'
      ? 'Repeats the preceding element zero or more times'
      : c === '+'
        ? 'Repeats the preceding element one or more times'
        : 'Makes the preceding element optional — zero or one time'
  return lazy ? `${base}, lazily (as few as possible).` : `${base}, greedily (as many as possible).`
}

function describeBraceQuantifier(body: string, lazy: boolean): string {
  const greed = lazy ? ', lazily (as few as possible)' : ', greedily (as many as possible)'
  const parts = body.split(',')
  if (parts.length === 1) {
    return `Repeats the preceding element exactly ${parts[0]} times.`
  }
  if (parts[1].trim().length === 0) {
    return `Repeats the preceding element ${parts[0]} or more times${greed}.`
  }
  return `Repeats the preceding element between ${parts[0]} and ${parts[1]} times, inclusive${greed}.`
}

function describeCharacterClass(body: string): string {
  const negated = body.startsWith('^')
  const content = negated ? body.substring(1) : body
  const parts: string[] = []

  let i = 0
  while (i < content.length) {
    if (content[i] === '\\' && i + 1 < content.length) {
      const [consumed, tok] = escapeToken(content, i)
      parts.push(tok)
      i += consumed
      continue
    }
    if (i + 2 < content.length && content[i + 1] === '-' && content[i + 2] !== ']') {
      parts.push(`${content[i]}-${content[i + 2]}`)
      i += 3
      continue
    }
    parts.push(content[i])
    i++
  }

  const listed = parts.length === 0 ? '(empty)' : parts.join(', ')
  return negated
    ? `Character class: matches any one character NOT in this set — ${listed}.`
    : `Character class: matches any one character from this set — ${listed}.`
}

/**
 * End index of a `{n}` / `{n,}` / `{n,m}` quantifier that starts at `open`,
 * or -1 when the brace is not a quantifier (and so is a literal).
 */
function braceQuantifierEnd(pattern: string, open: number): number {
  const close = pattern.indexOf('}', open + 1)
  if (close < 0) return -1
  const body = pattern.substring(open + 1, close)
  if (body.length === 0) return -1
  if (!/^\d+(,\d*)?$/.test(body)) return -1
  return close
}

type GroupKind = 'capturing' | 'named' | 'other'

/**
 * Returns [tokenText, kind, extra] for the group opener starting at `i`,
 * where `extra` is the group name for named groups and the description for
 * non-capturing/lookaround kinds.
 */
function groupOpener(pattern: string, i: number): [string, GroupKind, string] {
  const rest = pattern.substring(i)
  if (rest.startsWith('(?:')) {
    return ['(?:', 'other', 'Start of a non-capturing group — groups the sub-pattern without capturing it.']
  }
  if (rest.startsWith('(?=')) {
    return ['(?=', 'other', 'Positive lookahead: the following sub-pattern must match here, but it is not consumed.']
  }
  if (rest.startsWith('(?!')) {
    return [
      '(?!',
      'other',
      'Negative lookahead: the following sub-pattern must NOT match here; nothing is consumed.',
    ]
  }
  if (rest.startsWith('(?<=')) {
    return [
      '(?<=',
      'other',
      'Positive lookbehind: the text immediately before this position must match the sub-pattern.',
    ]
  }
  if (rest.startsWith('(?<!')) {
    return [
      '(?<!',
      'other',
      'Negative lookbehind: the text immediately before this position must NOT match the sub-pattern.',
    ]
  }
  if (rest.startsWith('(?<')) {
    const close = rest.indexOf('>')
    if (close > 0) {
      return [rest.substring(0, close + 1), 'named', rest.substring(3, close)]
    }
  }
  return ['(', 'capturing', '']
}
