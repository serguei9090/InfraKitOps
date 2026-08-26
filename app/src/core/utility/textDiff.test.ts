import { describe, expect, it } from 'vitest'
import { diffHunkHeader, diffIsIdentical, TextDiff } from './textDiff'

describe('TextDiff', () => {
  const differ = new TextDiff()

  describe('LCS behavior', () => {
    it('an inserted line shifts nothing else (proves real LCS, not positional diff)', () => {
      // A naive positional (index-by-index) comparison would report every
      // line from "b" onward as changed once one line is inserted above them,
      // because it never re-aligns the sequences. A real LCS diff instead
      // recognises "b", "c", "d" as still present unchanged and reports only
      // the inserted line.
      const left = 'a\nb\nc\nd'
      const right = 'a\nX\nb\nc\nd'

      const result = differ.execute({ left, right })

      expect(result.isValid).toBe(true)

      // Exactly one added line, the rest unchanged.
      expect(result.summary.added).toBe(1)
      expect(result.summary.removed).toBe(0)
      expect(result.summary.changed).toBe(0)
      expect(result.summary.unchanged).toBe(4)

      // Assert on the actual output shape: 'a' unchanged, 'X' added, then
      // 'b', 'c', 'd' unchanged — none of them re-reported as changed/removed
      // just because their position shifted by one line.
      const kinds = result.lines.map((l) => l.kind)
      const texts = result.lines.map((l) => l.text)
      expect(kinds).toEqual(['unchanged', 'added', 'unchanged', 'unchanged', 'unchanged'])
      expect(texts).toEqual(['a', 'X', 'b', 'c', 'd'])

      // Line numbers confirm b/c/d kept their identity across the shift:
      // each one's rightLineNumber is one more than its leftLineNumber, but
      // they are still paired as the *same* unchanged line, not new adds.
      const b = result.lines.find((l) => l.text === 'b')!
      expect(b.kind).toBe('unchanged')
      expect(b.leftLineNumber).toBe(2)
      expect(b.rightLineNumber).toBe(3)

      const d = result.lines.find((l) => l.text === 'd')!
      expect(d.kind).toBe('unchanged')
      expect(d.leftLineNumber).toBe(4)
      expect(d.rightLineNumber).toBe(5)
    })

    it('a removed line is reported once, surrounding lines stay unchanged', () => {
      const left = 'a\nb\nc\nd'
      const right = 'a\nc\nd'

      const result = differ.execute({ left, right })

      expect(result.summary.removed).toBe(1)
      expect(result.summary.added).toBe(0)
      expect(result.summary.changed).toBe(0)
      expect(result.summary.unchanged).toBe(3)

      const kinds = result.lines.map((l) => l.kind)
      const texts = result.lines.map((l) => l.text)
      expect(kinds).toEqual(['unchanged', 'removed', 'unchanged', 'unchanged'])
      expect(texts).toEqual(['a', 'b', 'c', 'd'])
    })

    it('a changed line shows as a removed/added pair counted as one changed line', () => {
      const left = 'a\nb\nc'
      const right = 'a\nB\nc'

      const result = differ.execute({ left, right })

      expect(result.summary.changed).toBe(1)
      expect(result.summary.added).toBe(0)
      expect(result.summary.removed).toBe(0)
      expect(result.summary.unchanged).toBe(2)

      const kinds = result.lines.map((l) => l.kind)
      expect(kinds).toEqual(['unchanged', 'removed', 'added', 'unchanged'])
    })

    it('identical inputs produce all-unchanged output with zero change counts', () => {
      const text = 'one\ntwo\nthree'
      const result = differ.execute({ left: text, right: text })

      expect(result.isValid).toBe(true)
      expect(diffIsIdentical(result)).toBe(true)
      expect(result.summary.added).toBe(0)
      expect(result.summary.removed).toBe(0)
      expect(result.summary.changed).toBe(0)
      expect(result.summary.unchanged).toBe(3)
      expect(result.lines.every((l) => l.kind === 'unchanged')).toBe(true)
      expect(result.hunks).toEqual([])
    })
  })

  describe('options', () => {
    it('ignoreWhitespace treats differently-padded lines as equal, display text untouched', () => {
      const left = 'a\n  b  \nc'
      const right = 'a\nb\nc'

      const result = differ.execute({ left, right, ignoreWhitespace: true })

      expect(diffIsIdentical(result)).toBe(true)
      // Display text preserves the original padding on the left side.
      const line = result.lines.find((l) => l.leftLineNumber === 2)!
      expect(line.text).toBe('  b  ')
    })

    it('ignoreCase treats differently-cased lines as equal', () => {
      const left = 'Hello\nWorld'
      const right = 'hello\nworld'

      const result = differ.execute({ left, right, ignoreCase: true })

      expect(diffIsIdentical(result)).toBe(true)
    })

    it('without ignoreCase, case differences are reported as changes', () => {
      const left = 'Hello'
      const right = 'hello'

      const result = differ.execute({ left, right })

      expect(diffIsIdentical(result)).toBe(false)
      expect(result.summary.changed).toBe(1)
    })
  })

  describe('JSON mode', () => {
    it('reordered keys are treated as identical', () => {
      const left = '{"a": 1, "b": 2}'
      const right = '{"b": 2, "a": 1}'

      const result = differ.execute({ left, right, mode: 'json' })

      expect(result.isValid).toBe(true)
      expect(diffIsIdentical(result)).toBe(true)
    })

    it('different values are reported as changed', () => {
      const left = '{"a": 1, "b": 2}'
      const right = '{"a": 1, "b": 3}'

      const result = differ.execute({ left, right, mode: 'json' })

      expect(result.isValid).toBe(true)
      expect(diffIsIdentical(result)).toBe(false)
    })

    it('reformatted whitespace with the same structure is identical', () => {
      const left = '{"a":1,"b":[1,2,3]}'
      const right = `
      {
        "a": 1,
        "b": [1, 2, 3]
      }
      `

      const result = differ.execute({ left, right, mode: 'json' })

      expect(result.isValid).toBe(true)
      expect(diffIsIdentical(result)).toBe(true)
    })

    it('list order is preserved and reordered array elements are a real difference', () => {
      const left = '[1, 2, 3]'
      const right = '[3, 2, 1]'

      const result = differ.execute({ left, right, mode: 'json' })

      expect(result.isValid).toBe(true)
      expect(diffIsIdentical(result)).toBe(false)
    })

    it('invalid JSON on the left errors cleanly instead of diffing garbage', () => {
      const left = '{"a": 1,}'
      const right = '{"a": 1}'

      const result = differ.execute({ left, right, mode: 'json' })

      expect(result.isValid).toBe(false)
      expect(result.errorMessage).not.toBeUndefined()
      expect(result.errorMessage).toContain('Left')
      expect(result.lines).toEqual([])
    })

    it('invalid JSON on the right errors cleanly and names the right side', () => {
      const left = '{"a": 1}'
      const right = 'not json at all'

      const result = differ.execute({ left, right, mode: 'json' })

      expect(result.isValid).toBe(false)
      expect(result.errorMessage).not.toBeUndefined()
      expect(result.errorMessage).toContain('Right')
    })

    it('an empty side in JSON mode errors cleanly', () => {
      const result = differ.execute({ left: '', right: '{"a": 1}', mode: 'json' })

      expect(result.isValid).toBe(false)
      expect(result.errorMessage).not.toBeUndefined()
    })
  })

  describe('hunks', () => {
    it('no hunks are produced for identical input', () => {
      const result = differ.execute({ left: 'x\ny', right: 'x\ny' })
      expect(result.hunks).toEqual([])
    })

    it('a hunk groups the changed lines with the header reflecting line ranges', () => {
      const left = 'a\nb\nc\nd\ne'
      const right = 'a\nB\nc\nd\ne'

      const result = differ.execute({ left, right, contextLines: 1 })

      expect(result.hunks).toHaveLength(1)
      expect(diffHunkHeader(result.hunks[0]).startsWith('@@')).toBe(true)
    })
  })
})
