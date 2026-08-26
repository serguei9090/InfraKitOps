import { describe, expect, it } from 'vitest'
import { didParticipate, flagString, groupLabel, matchCount, namedGroups, RegexTester } from './regexTester'

describe('RegexTester', () => {
  const tester = new RegexTester()

  describe('matching', () => {
    it('finds every match with correct start/end offsets', () => {
      const result = tester.execute({ pattern: '\\d+', subject: 'a12b345c6' })

      expect(result.isValid).toBe(true)
      expect(matchCount(result)).toBe(3)

      expect(result.matches[0].text).toBe('12')
      expect(result.matches[0].start).toBe(1)
      expect(result.matches[0].end).toBe(3)

      expect(result.matches[1].text).toBe('345')
      expect(result.matches[1].start).toBe(4)
      expect(result.matches[1].end).toBe(7)

      expect(result.matches[2].text).toBe('6')
      expect(result.matches[2].start).toBe(8)
      expect(result.matches[2].end).toBe(9)

      // Offsets are usable as substring bounds on the original subject.
      for (const match of result.matches) {
        expect('a12b345c6'.substring(match.start, match.end)).toBe(match.text)
      }
    })

    it('reports zero matches without erroring', () => {
      const result = tester.execute({ pattern: '\\d+', subject: 'no digits here' })

      expect(result.isValid).toBe(true)
      expect(matchCount(result)).toBe(0)
      expect(result.errorMessage).toBeUndefined()
      expect(result.explanation.length).toBeGreaterThan(0)
    })
  })

  describe('capture groups', () => {
    it('reports numbered groups in order', () => {
      const result = tester.execute({ pattern: '(\\w+)@(\\w+)\\.com', subject: 'mail ops@example.com now' })

      expect(result.isValid).toBe(true)
      expect(matchCount(result)).toBe(1)

      const groups = result.matches[0].groups
      expect(groups).toHaveLength(2)
      expect(groups[0].index).toBe(1)
      expect(groups[0].value).toBe('ops')
      expect(groups[0].name).toBeUndefined()
      expect(groups[1].index).toBe(2)
      expect(groups[1].value).toBe('example')
    })

    it('reports named groups with both their name and number', () => {
      const result = tester.execute({
        pattern: '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})',
        subject: 'released 2024-07-19',
      })

      expect(result.isValid).toBe(true)
      const match = result.matches[0]
      expect(match.text).toBe('2024-07-19')

      const byName = Object.fromEntries(namedGroups(match).map((g) => [g.name, g.value]))
      expect(byName).toEqual({ year: '2024', month: '07', day: '19' })

      const year = match.groups.find((g) => g.name === 'year')!
      expect(year.index).toBe(1)
      expect(groupLabel(year)).toBe('1 (year)')
    })

    it('keeps non-participating groups with an undefined value', () => {
      const result = tester.execute({ pattern: '(a)|(b)', subject: 'a' })

      const groups = result.matches[0].groups
      expect(groups).toHaveLength(2)
      expect(groups[0].value).toBe('a')
      expect(didParticipate(groups[0])).toBe(true)
      expect(groups[1].value).toBeUndefined()
      expect(didParticipate(groups[1])).toBe(false)
    })
  })

  describe('flags', () => {
    it('caseInsensitive changes what matches', () => {
      const sensitive = { pattern: 'hello', subject: 'Hello HELLO hello' }
      const insensitive = { pattern: 'hello', subject: 'Hello HELLO hello', caseInsensitive: true }

      expect(matchCount(tester.execute(sensitive))).toBe(1)
      expect(matchCount(tester.execute(insensitive))).toBe(3)
    })

    it('multiLine makes ^ match at each line start', () => {
      const subject = 'one\ntwo\nthree'
      const off = { pattern: '^\\w+', subject }
      const on = { pattern: '^\\w+', subject, multiLine: true }

      expect(matchCount(tester.execute(off))).toBe(1)
      expect(matchCount(tester.execute(on))).toBe(3)
      expect(tester.execute(on).matches.map((m) => m.text)).toEqual(['one', 'two', 'three'])
    })

    it('dotAll lets . cross a line break', () => {
      const off = { pattern: 'a.b', subject: 'a\nb' }
      const on = { pattern: 'a.b', subject: 'a\nb', dotAll: true }

      expect(matchCount(tester.execute(off))).toBe(0)
      expect(matchCount(tester.execute(on))).toBe(1)
      expect(tester.execute(on).matches[0].text).toBe('a\nb')
    })

    it('unicode makes . consume a whole code point', () => {
      // U+1F600 is a surrogate pair: two UTF-16 code units, one code point.
      const subject = '\u{1F600}'
      expect(subject.length).toBe(2)

      expect(matchCount(tester.execute({ pattern: '.', subject }))).toBe(2)
      expect(matchCount(tester.execute({ pattern: '.', subject, unicode: true }))).toBe(1)
    })

    it('flagString reflects the enabled flags', () => {
      const input = {
        pattern: 'x',
        subject: 'x',
        caseInsensitive: true,
        multiLine: true,
        dotAll: true,
        unicode: true,
      }
      expect(flagString(input)).toBe('gimsu')
      expect(flagString({ pattern: 'x', subject: 'x' })).toBe('g')
    })
  })

  describe('error handling', () => {
    it('an unbalanced group returns an error result instead of throwing', () => {
      let result: ReturnType<typeof tester.execute>
      expect(() => (result = tester.execute({ pattern: '(unclosed', subject: 'abc' }))).not.toThrow()

      expect(result!.isValid).toBe(false)
      expect(result!.errorMessage).not.toBeUndefined()
      expect(result!.errorMessage).toContain('Invalid pattern')
      expect(result!.matches).toHaveLength(0)
    })

    it('a dangling quantifier returns an error result', () => {
      const result = tester.execute({ pattern: '*abc', subject: 'abc' })

      expect(result.isValid).toBe(false)
      expect(result.errorMessage).not.toBeUndefined()
    })

    it('an empty pattern is reported, not matched', () => {
      const result = tester.execute({ pattern: '', subject: 'abc' })

      expect(result.isValid).toBe(false)
      expect(result.errorMessage).not.toBeUndefined()
    })
  })

  describe('safety caps', () => {
    it('truncates an over-long subject and says so', () => {
      const subject = 'a'.repeat(RegexTester.maxSubjectLength + 500)
      const result = tester.execute({ pattern: 'a', subject })

      expect(result.isValid).toBe(true)
      expect(result.subjectTruncated).toBe(true)
      expect(matchCount(result)).toBe(RegexTester.maxMatches)
      expect(result.matchesTruncated).toBe(true)
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it('warns about a nested quantifier that risks catastrophic backtracking', () => {
      const result = tester.execute({ pattern: '(a+)+$', subject: 'aaaa!' })

      expect(result.isValid).toBe(true)
      expect(result.warnings).toContain(RegexTester.nestedQuantifierWarning)
    })

    it('does not warn about an ordinary quantified group', () => {
      const result = tester.execute({ pattern: '(ab)+', subject: 'abab' })

      expect(result.warnings).not.toContain(RegexTester.nestedQuantifierWarning)
    })
  })

  describe('pattern explainer', () => {
    const describePattern = (pattern: string) =>
      tester.explain(pattern).map((t) => `${t.token} :: ${t.description}`)

    it('names the constructs in a representative pattern', () => {
      const pattern = '^(?<user>[a-z0-9._]+)@(?:mail\\.)?example\\.com$'
      const tokens = tester.explain(pattern)
      const joined = describePattern(pattern).join('\n')

      expect(tokens.length).toBeGreaterThan(0)
      expect(joined).toContain('Anchor: start of the string')
      expect(joined).toContain('named capturing group "user"')
      expect(joined).toContain('Character class')
      expect(joined).toContain('Repeats the preceding element one or more times')
      expect(joined).toContain('non-capturing group')
      expect(joined).toContain('Makes the preceding element optional')
      expect(joined).toContain('Anchor: end of the string')

      // Every token is a real slice of the pattern, in order.
      expect(tokens.map((t) => t.token).join('')).toBe(pattern)
    })

    it('describes shorthand classes, anchors and alternation', () => {
      const joined = describePattern('\\bcat|dog\\b\\s\\S\\W').join('\n')

      expect(joined).toContain('Word boundary')
      expect(joined).toContain('Alternation')
      expect(joined).toContain('whitespace')
      expect(joined).toContain('non-whitespace')
      expect(joined).toContain('not a word character')
    })

    it('describes quantifiers including lazy and braced forms', () => {
      const joined = describePattern('a*?b{2,4}c{3}').join('\n')

      expect(joined).toContain('zero or more times, lazily')
      expect(joined).toContain('between 2 and 4 times')
      expect(joined).toContain('exactly 3 times')
    })

    it('describes all four lookaround forms', () => {
      const joined = describePattern('(?=a)(?!b)(?<=c)(?<!d)').join('\n')

      expect(joined).toContain('Positive lookahead')
      expect(joined).toContain('Negative lookahead')
      expect(joined).toContain('Positive lookbehind')
      expect(joined).toContain('Negative lookbehind')
    })

    it('splits a literal run so a quantifier attaches to one character', () => {
      const tokens = tester.explain('abc+')

      expect(tokens.map((t) => t.token)).toEqual(['ab', 'c', '+'])
      expect(tokens[2].description).toContain('one or more times')
    })

    it('tracks nesting depth for indented rendering', () => {
      const tokens = tester.explain('((a))')
      const depths = Object.fromEntries(tokens.map((t) => [t.token, t.depth]))

      expect(depths['a']).toBe(2)
    })

    it('explains an invalid pattern even though matching fails', () => {
      const result = tester.execute({ pattern: '(\\d+', subject: '123' })

      expect(result.isValid).toBe(false)
      expect(result.explanation.length).toBeGreaterThan(0)
      expect(result.explanation.map((t) => t.description).join('\n')).toContain('capturing group 1')
    })
  })
})
