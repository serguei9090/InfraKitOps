import type { IToolUseCase } from '../ports/IToolUseCase'

export type DiffLineKind = 'unchanged' | 'added' | 'removed'

/** Compare the two sides as raw text, or canonicalise both as JSON first. */
export type DiffMode = 'text' | 'json'

export interface DiffLine {
  kind: DiffLineKind
  /**
   * The line's text, exactly as it appeared on its own side (whitespace and
   * case are normalised for *comparison* only, never for display).
   */
  text: string
  /** 1-based line number on the left/original side; undefined for added lines. */
  leftLineNumber?: number
  /** 1-based line number on the right/modified side; undefined for removed lines. */
  rightLineNumber?: number
}

/** `' '`, `'+'` or `'-'` — the unified-diff style marker for this line. */
export function diffLineMarker(line: DiffLine): string {
  switch (line.kind) {
    case 'unchanged':
      return ' '
    case 'added':
      return '+'
    case 'removed':
      return '-'
  }
}

/**
 * A contiguous run of changed lines plus surrounding context, the way a
 * unified diff groups them.
 */
export interface DiffHunk {
  leftStart: number
  leftLength: number
  rightStart: number
  rightLength: number
  lines: DiffLine[]
}

/** `@@ -1,4 +1,5 @@` */
export function diffHunkHeader(hunk: DiffHunk): string {
  return `@@ -${hunk.leftStart},${hunk.leftLength} +${hunk.rightStart},${hunk.rightLength} @@`
}

export interface DiffSummary {
  /** Lines present only on the right, with no removed line paired against them. */
  added: number
  /** Lines present only on the left, with no added line paired against them. */
  removed: number
  /**
   * Removed/added pairs inside the same change block, counted once — the
   * "modified line" count a reader intuitively expects.
   */
  changed: number
  unchanged: number
}

export function diffHasDifferences(summary: DiffSummary): boolean {
  return summary.added > 0 || summary.removed > 0 || summary.changed > 0
}

export interface TextDiffInput {
  left: string
  right: string
  mode?: DiffMode
  /**
   * Ignore leading and trailing whitespace when deciding whether two lines
   * are equal. Display text is untouched.
   */
  ignoreWhitespace?: boolean
  /** Compare lines case-insensitively. Display text is untouched. */
  ignoreCase?: boolean
  /** Unchanged lines kept around each change block when building hunks. */
  contextLines?: number
}

export interface TextDiffResult {
  isValid: boolean
  errorMessage?: string
  /** The full diff, every line tagged, in output order. */
  lines: DiffLine[]
  /**
   * The same lines grouped into unified-diff hunks. Empty when the two sides
   * are identical.
   */
  hunks: DiffHunk[]
  summary: DiffSummary
  /** Non-fatal advisories, e.g. an input that hit the size cap. */
  warnings: string[]
  /** True when either side was cut down to fit the size caps. */
  truncated: boolean
}

const EMPTY_SUMMARY: DiffSummary = { added: 0, removed: 0, changed: 0, unchanged: 0 }

export function diffIsIdentical(result: TextDiffResult): boolean {
  return result.isValid && !diffHasDifferences(result.summary)
}

function invalidResult(errorMessage: string): TextDiffResult {
  return {
    isValid: false,
    errorMessage,
    lines: [],
    hunks: [],
    summary: EMPTY_SUMMARY,
    warnings: [],
    truncated: false,
  }
}

/**
 * Line-based diff built on a real longest-common-subsequence (LCS) dynamic
 * program, so inserting one line shifts nothing else — a naive positional
 * line-by-line comparison reports every following line as changed, which is
 * exactly the failure this implementation exists to avoid.
 *
 * ## Algorithm
 *
 * 1. Split both sides into lines and derive a *comparison key* per line
 *    (optionally trimmed and/or lower-cased). The key drives equality; the
 *    original text is what gets displayed.
 * 2. Strip the common prefix and common suffix. These are trivially
 *    unchanged and removing them keeps the quadratic step small in the
 *    common "one edit in a big file" case.
 * 3. Run the classic O(n·m) LCS DP over the remaining middle, then backtrack
 *    to emit removed / added / unchanged lines in order.
 *
 * ## Size caps
 *
 * The DP table is O(n·m) in both time and memory, so unbounded input hangs
 * the UI thread. Stripping the common prefix/suffix helps but cannot be
 * relied on (two entirely different files share neither), so hard caps are
 * applied to the raw input up front: each side is limited to `maxLines`
 * (2,000 lines) and `maxCharacters` (400,000 characters). Anything longer is
 * truncated, `TextDiffResult.truncated` is set, and a warning explains what
 * was dropped. A worst-case 2,000 x 2,000 table is 4M cells stored in a
 * `Uint16Array` (~8 MB) — the largest allocation that still computes
 * instantly, and safe because an LCS length can never exceed 2,000.
 */
export class TextDiff implements IToolUseCase<TextDiffInput, TextDiffResult> {
  /** Maximum lines compared per side; extra lines are dropped with a warning. */
  static readonly maxLines = 2000

  /** Maximum characters accepted per side before truncation. */
  static readonly maxCharacters = 400000

  execute(input: TextDiffInput): TextDiffResult {
    let left = input.left
    let right = input.right

    if (input.mode === 'json') {
      const [canonicalLeft, errorLeft] = canonicalJson(left, 'Left')
      if (errorLeft !== undefined) {
        return invalidResult(errorLeft)
      }
      const [canonicalRight, errorRight] = canonicalJson(right, 'Right')
      if (errorRight !== undefined) {
        return invalidResult(errorRight)
      }
      left = canonicalLeft!
      right = canonicalRight!
    }

    const warnings: string[] = []
    let truncated = false

    if (left.length > TextDiff.maxCharacters) {
      left = left.substring(0, TextDiff.maxCharacters)
      truncated = true
      warnings.push(`Left side truncated to ${TextDiff.maxCharacters} characters.`)
    }
    if (right.length > TextDiff.maxCharacters) {
      right = right.substring(0, TextDiff.maxCharacters)
      truncated = true
      warnings.push(`Right side truncated to ${TextDiff.maxCharacters} characters.`)
    }

    let leftLines = splitLines(left)
    let rightLines = splitLines(right)

    if (leftLines.length > TextDiff.maxLines) {
      warnings.push(`Left side truncated to ${TextDiff.maxLines} lines (was ${leftLines.length}).`)
      leftLines = leftLines.slice(0, TextDiff.maxLines)
      truncated = true
    }
    if (rightLines.length > TextDiff.maxLines) {
      warnings.push(`Right side truncated to ${TextDiff.maxLines} lines (was ${rightLines.length}).`)
      rightLines = rightLines.slice(0, TextDiff.maxLines)
      truncated = true
    }

    const lines = diffLines(leftLines, rightLines, {
      ignoreWhitespace: input.ignoreWhitespace ?? false,
      ignoreCase: input.ignoreCase ?? false,
    })

    return {
      isValid: true,
      lines,
      hunks: buildHunks(lines, input.contextLines ?? 3),
      summary: summarise(lines),
      warnings,
      truncated,
    }
  }
}

// -----------------------------------------------------------------------
// JSON canonicalisation
// -----------------------------------------------------------------------

/** Returns [canonicalText, errorMessage] — exactly one is defined. */
function canonicalJson(source: string, sideLabel: string): [string | undefined, string | undefined] {
  if (source.trim().length === 0) {
    return [undefined, `${sideLabel} side is empty — JSON mode needs a JSON document on both sides.`]
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(source)
  } catch (e) {
    return [undefined, `${sideLabel} side is not valid JSON: ${(e as Error).message}`]
  }
  try {
    return [JSON.stringify(sortKeys(decoded), null, 2), undefined]
  } catch (e) {
    return [undefined, `${sideLabel} side could not be re-serialised: ${(e as Error).message}`]
  }
}

/**
 * Recursively rebuild objects with their keys in sorted order. Array order
 * is significant in JSON and is preserved.
 */
function sortKeys(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const out: Record<string, unknown> = {}
    for (const key of keys) out[key] = sortKeys(obj[key])
    return out
  }
  if (Array.isArray(value)) return value.map(sortKeys)
  return value
}

// -----------------------------------------------------------------------
// LCS diff
// -----------------------------------------------------------------------

function splitLines(text: string): string[] {
  if (text.length === 0) return []
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalised.split('\n')
  // A trailing newline produces an empty final element; drop it so "a\n" and
  // "a" diff as identical content rather than differing by a blank line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function lineKey(line: string, opts: { ignoreWhitespace: boolean; ignoreCase: boolean }): string {
  let key = line
  if (opts.ignoreWhitespace) key = key.trim()
  if (opts.ignoreCase) key = key.toLowerCase()
  return key
}

function diffLines(
  left: string[],
  right: string[],
  opts: { ignoreWhitespace: boolean; ignoreCase: boolean },
): DiffLine[] {
  const leftKeys = left.map((l) => lineKey(l, opts))
  const rightKeys = right.map((r) => lineKey(r, opts))

  const out: DiffLine[] = []

  // 1. Common prefix.
  let prefix = 0
  while (prefix < leftKeys.length && prefix < rightKeys.length && leftKeys[prefix] === rightKeys[prefix]) {
    out.push({ kind: 'unchanged', text: left[prefix], leftLineNumber: prefix + 1, rightLineNumber: prefix + 1 })
    prefix++
  }

  // 2. Common suffix (never overlapping the prefix).
  let suffix = 0
  while (
    suffix < leftKeys.length - prefix &&
    suffix < rightKeys.length - prefix &&
    leftKeys[leftKeys.length - 1 - suffix] === rightKeys[rightKeys.length - 1 - suffix]
  ) {
    suffix++
  }

  const leftMid = leftKeys.slice(prefix, leftKeys.length - suffix)
  const rightMid = rightKeys.slice(prefix, rightKeys.length - suffix)

  // 3. LCS dynamic program over the middle.
  //    table[i][j] = length of the LCS of leftMid[i..] and rightMid[j..].
  const n = leftMid.length
  const m = rightMid.length
  const stride = m + 1
  // Flat (n+1) x (m+1) table of 16-bit cells; an LCS length is bounded by
  // maxLines (2,000) so it always fits.
  const table = new Uint16Array((n + 1) * stride)
  for (let i = n - 1; i >= 0; i--) {
    const row = i * stride
    const next = (i + 1) * stride
    const leftValue = leftMid[i]
    for (let j = m - 1; j >= 0; j--) {
      table[row + j] =
        leftValue === rightMid[j]
          ? table[next + j + 1] + 1
          : Math.max(table[next + j], table[row + j + 1])
    }
  }

  // 4. Backtrack, emitting lines in order.
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (leftMid[i] === rightMid[j]) {
      out.push({
        kind: 'unchanged',
        text: left[prefix + i],
        leftLineNumber: prefix + i + 1,
        rightLineNumber: prefix + j + 1,
      })
      i++
      j++
    } else if (table[(i + 1) * stride + j] >= table[i * stride + j + 1]) {
      out.push({ kind: 'removed', text: left[prefix + i], leftLineNumber: prefix + i + 1 })
      i++
    } else {
      out.push({ kind: 'added', text: right[prefix + j], rightLineNumber: prefix + j + 1 })
      j++
    }
  }
  while (i < n) {
    out.push({ kind: 'removed', text: left[prefix + i], leftLineNumber: prefix + i + 1 })
    i++
  }
  while (j < m) {
    out.push({ kind: 'added', text: right[prefix + j], rightLineNumber: prefix + j + 1 })
    j++
  }

  // 5. Common suffix.
  for (let k = 0; k < suffix; k++) {
    const leftIndex = leftKeys.length - suffix + k
    const rightIndex = rightKeys.length - suffix + k
    out.push({
      kind: 'unchanged',
      text: left[leftIndex],
      leftLineNumber: leftIndex + 1,
      rightLineNumber: rightIndex + 1,
    })
  }

  return out
}

// -----------------------------------------------------------------------
// Summary & hunks
// -----------------------------------------------------------------------

/**
 * Within each contiguous run of non-unchanged lines, `min(removed, added)`
 * lines are reported as *changed* and only the excess as pure added/removed.
 */
function summarise(lines: DiffLine[]): DiffSummary {
  let added = 0
  let removed = 0
  let changed = 0
  let unchanged = 0

  let blockAdded = 0
  let blockRemoved = 0

  const closeBlock = () => {
    const paired = Math.min(blockAdded, blockRemoved)
    changed += paired
    added += blockAdded - paired
    removed += blockRemoved - paired
    blockAdded = 0
    blockRemoved = 0
  }

  for (const line of lines) {
    switch (line.kind) {
      case 'unchanged':
        closeBlock()
        unchanged++
        break
      case 'added':
        blockAdded++
        break
      case 'removed':
        blockRemoved++
        break
    }
  }
  closeBlock()

  return { added, removed, changed, unchanged }
}

function buildHunks(lines: DiffLine[], contextLines: number): DiffHunk[] {
  const changedIndexes: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind !== 'unchanged') changedIndexes.push(i)
  }
  if (changedIndexes.length === 0) return []

  const context = contextLines < 0 ? 0 : contextLines
  const ranges: [number, number][] = []
  for (const index of changedIndexes) {
    const start = index - context < 0 ? 0 : index - context
    const end = index + context >= lines.length ? lines.length - 1 : index + context
    if (ranges.length > 0 && start <= ranges[ranges.length - 1][1] + 1) {
      if (end > ranges[ranges.length - 1][1]) ranges[ranges.length - 1][1] = end
    } else {
      ranges.push([start, end])
    }
  }

  return ranges.map(([start, end]) => hunkFor(lines.slice(start, end + 1)))
}

function hunkFor(slice: DiffLine[]): DiffHunk {
  let leftStart: number | undefined
  let rightStart: number | undefined
  let leftLength = 0
  let rightLength = 0

  for (const line of slice) {
    if (line.leftLineNumber !== undefined) {
      if (leftStart === undefined) leftStart = line.leftLineNumber
      leftLength++
    }
    if (line.rightLineNumber !== undefined) {
      if (rightStart === undefined) rightStart = line.rightLineNumber
      rightLength++
    }
  }

  return {
    leftStart: leftStart ?? 0,
    leftLength,
    rightStart: rightStart ?? 0,
    rightLength,
    lines: slice,
  }
}
