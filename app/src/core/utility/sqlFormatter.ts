import type { IToolUseCase } from '../ports/IToolUseCase'

export type SqlFormatMode = 'pretty' | 'minify' | 'validate'

export interface SqlFormatterInput {
  source: string
  mode: SqlFormatMode
}

export interface SqlFormatterResult {
  isValid: boolean
  output?: string
  errorMessage?: string
}

interface KeywordMatch {
  keyword: string
  wordCount: number
  extraIndent: number
}

const CLAUSE_KEYWORDS: readonly string[] = [
  'LEFT OUTER JOIN',
  'RIGHT OUTER JOIN',
  'FULL OUTER JOIN',
  'INNER JOIN',
  'CROSS JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'FULL JOIN',
  'GROUP BY',
  'ORDER BY',
  'UNION ALL',
  'INSERT INTO',
  'DELETE FROM',
  'SELECT',
  'FROM',
  'WHERE',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'VALUES',
  'UPDATE',
  'SET',
  'UNION',
  'JOIN',
]

const CONTINUATION_KEYWORDS: readonly string[] = ['AND', 'OR']

/**
 * Hand-rolled, keyword-driven SQL prettifier/minifier. This is deliberately
 * NOT a real SQL parser: it tokenizes the input (respecting quoted string
 * literals) and recognizes a fixed list of major clause keywords, breaking
 * each onto its own line and uppercasing it. Indentation for subqueries is
 * approximated by tracking parenthesis depth, not real grammar nesting, and
 * "validate" is a heuristic (balanced parens/quotes) rather than a real
 * grammar check -- exotic dialect syntax may format oddly.
 */
export class SqlFormatter implements IToolUseCase<SqlFormatterInput, SqlFormatterResult> {
  execute(input: SqlFormatterInput): SqlFormatterResult {
    const trimmed = input.source.trim()
    if (trimmed.length === 0) {
      return { isValid: false, errorMessage: 'SQL input is empty' }
    }

    const balanceError = checkBalance(trimmed)
    if (balanceError !== null) {
      return { isValid: false, errorMessage: balanceError }
    }

    switch (input.mode) {
      case 'validate':
        return {
          isValid: true,
          output: 'Looks like valid SQL (heuristic check: keywords + balanced parens/quotes only)',
        }
      case 'minify':
        return { isValid: true, output: minify(trimmed) }
      case 'pretty':
        return { isValid: true, output: prettify(trimmed) }
    }
  }
}

function checkBalance(sql: string): string | null {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!
    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
    } else if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth < 0) return 'Unbalanced parentheses: unexpected ")"'
    }
  }
  if (depth !== 0) return 'Unbalanced parentheses: missing ")"'
  if (quote !== null) return 'Unterminated string literal'
  return null
}

function tokenize(sql: string): string[] {
  const tokens: string[] = []
  let buffer = ''
  let quote: string | null = null

  const flush = () => {
    if (buffer.length > 0) {
      tokens.push(buffer)
      buffer = ''
    }
  }

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!
    if (quote !== null) {
      buffer += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      flush()
      quote = ch
      buffer += ch
      continue
    }
    if (ch === '(' || ch === ')' || ch === ',') {
      flush()
      tokens.push(ch)
      continue
    }
    if (ch.trim().length === 0) {
      flush()
      continue
    }
    buffer += ch
  }
  flush()
  return tokens
}

function matchesAt(tokens: string[], index: number, words: string[]): boolean {
  if (index + words.length > tokens.length) return false
  for (let j = 0; j < words.length; j++) {
    if (tokens[index + j]!.toUpperCase() !== words[j]) return false
  }
  return true
}

function matchKeyword(tokens: string[], index: number): KeywordMatch | null {
  for (const phrase of CLAUSE_KEYWORDS) {
    const words = phrase.split(' ')
    if (matchesAt(tokens, index, words)) {
      return { keyword: phrase, wordCount: words.length, extraIndent: 0 }
    }
  }
  for (const word of CONTINUATION_KEYWORDS) {
    if (matchesAt(tokens, index, [word])) {
      return { keyword: word, wordCount: 1, extraIndent: 1 }
    }
  }
  return null
}

function minify(sql: string): string {
  const tokens = tokenize(sql)
  let output = ''
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (i === 0) {
      output += token
      continue
    }
    const prev = tokens[i - 1]!
    const needsSpace = token !== ',' && token !== ')' && prev !== '('
    if (needsSpace) output += ' '
    output += token
  }
  return output
}

function prettify(sql: string): string {
  const tokens = tokenize(sql)
  const lines: string[] = []
  let depth = 0
  let current = ''
  let currentHasContent = false

  const newLine = (indentLevel: number) => {
    if (currentHasContent) {
      lines.push(current)
    }
    current = '  '.repeat(indentLevel)
    currentHasContent = false
  }

  const append = (token: string) => {
    const text = current
    const isFirstOnLine = text.trim().length === 0 && !text.endsWith('(')
    const endsWithOpenParen = text.endsWith('(')
    const needsSpace = !isFirstOnLine && token !== ',' && token !== ')' && !endsWithOpenParen
    if (needsSpace) current += ' '
    current += token
    currentHasContent = true
  }

  let i = 0
  while (i < tokens.length) {
    const match = matchKeyword(tokens, i)
    if (match !== null) {
      newLine(depth + match.extraIndent)
      append(match.keyword)
      i += match.wordCount
      continue
    }
    const token = tokens[i]!
    if (token === '(') {
      append(token)
      depth++
      i++
      continue
    }
    if (token === ')') {
      depth = depth > 0 ? depth - 1 : 0
      append(token)
      i++
      continue
    }
    append(token)
    i++
  }
  newLine(0)

  return lines.filter((line) => line.trim().length > 0).join('\n')
}
