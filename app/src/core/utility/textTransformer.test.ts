import { describe, expect, it } from 'vitest'
import { LINE_OPERATIONS, LineOperationRunner, TEXT_CASES, TextCaseConverter, TextTransformer } from './textTransformer'

describe('TextTransformer', () => {
  const transformer = new TextTransformer()

  describe('case conversion — from an already-differently-cased source', () => {
    // Source is camelCase/PascalCase with an acronym, deliberately NOT the
    // target case, so a naive boundary detector (e.g. one that just splits
    // on every uppercase letter) would shred the acronym.
    const source = 'XMLHttpRequest'

    it('camelCase', () => {
      expect(transformer.convertCase(source, 'camel').output).toBe('xmlHttpRequest')
    })

    it('PascalCase', () => {
      expect(transformer.convertCase(source, 'pascal').output).toBe('XmlHttpRequest')
    })

    it('snake_case does not shred the acronym into single letters', () => {
      expect(transformer.convertCase(source, 'snake').output).toBe('xml_http_request')
    })

    it('SCREAMING_SNAKE_CASE', () => {
      expect(transformer.convertCase(source, 'screamingSnake').output).toBe('XML_HTTP_REQUEST')
    })

    it('kebab-case', () => {
      expect(transformer.convertCase(source, 'kebab').output).toBe('xml-http-request')
    })

    it('Train-Case', () => {
      expect(transformer.convertCase(source, 'train').output).toBe('Xml-Http-Request')
    })

    it('dot.case', () => {
      expect(transformer.convertCase(source, 'dot').output).toBe('xml.http.request')
    })

    it('Title Case', () => {
      expect(transformer.convertCase(source, 'title').output).toBe('Xml Http Request')
    })

    it('Sentence case', () => {
      expect(transformer.convertCase(source, 'sentence').output).toBe('Xml http request')
    })

    it('lowercase preserves layout (no re-splitting)', () => {
      expect(transformer.convertCase('Some-Thing_Here', 'lower').output).toBe('some-thing_here')
    })

    it('UPPERCASE preserves layout (no re-splitting)', () => {
      expect(transformer.convertCase('Some-Thing_Here', 'upper').output).toBe('SOME-THING_HERE')
    })

    it('a snake_case source converts cleanly to camelCase', () => {
      expect(transformer.convertCase('user_name_id', 'camel').output).toBe('userNameId')
    })

    it('a kebab-case source converts cleanly to PascalCase', () => {
      expect(transformer.convertCase('user-name-id', 'pascal').output).toBe('UserNameId')
    })

    it('digits form their own word boundary', () => {
      expect(transformer.convertCase('parseHTTP2Response', 'snake').output).toBe('parse_http_2_response')
    })
  })

  describe('splitWords boundary detection', () => {
    it('splits camelCase at lower-to-upper boundary', () => {
      expect(TextCaseConverter.splitWords('fooBar')).toEqual(['foo', 'Bar'])
    })

    it('splits acronym-followed-by-word at the acronym end, not every capital', () => {
      expect(TextCaseConverter.splitWords('XMLHttpRequest')).toEqual(['XML', 'Http', 'Request'])
    })

    it('splits on non-alphanumeric separators', () => {
      expect(TextCaseConverter.splitWords('user_name-id.here')).toEqual(['user', 'name', 'id', 'here'])
    })
  })

  describe('slugify', () => {
    it('accented characters are folded to their ASCII base', () => {
      expect(transformer.slugify('Café déjà vu').output).toBe('cafe-deja-vu')
    })

    it('punctuation is stripped and runs of separators collapse', () => {
      expect(transformer.slugify('Hello, World!!! -- Foo').output).toBe('hello-world-foo')
    })

    it('ligatures expand per the fold table (ß -> ss, æ -> ae)', () => {
      expect(transformer.slugify('Straße').output).toBe('strasse')
      expect(transformer.slugify('Ærøskøbing').output).toBe('aeroskobing')
    })

    it('a custom separator is honored', () => {
      expect(transformer.slugify('Hello World', { separator: '_' }).output).toBe('hello_world')
    })

    it('lowercase: false preserves case', () => {
      expect(transformer.slugify('Hello World', { lowercase: false }).output).toBe('Hello-World')
    })

    it('maxLength truncates at a separator boundary, not mid-word', () => {
      const result = transformer.slugify('one two three four five', { maxLength: 10 })
      expect(result.output.length).toBeLessThanOrEqual(10)
      expect(result.output.endsWith('-')).toBe(false)
      // The hard cut at 10 chars lands inside "three" ("one-two-th"); the
      // dangling partial word must be trimmed back to the last full word.
      expect(result.output).toBe('one-two')
    })

    it('maxLength below 1 is rejected', () => {
      expect(() => transformer.slugify('hello', { maxLength: 0 })).toThrow()
    })

    it('leading and trailing punctuation does not leave a dangling separator', () => {
      expect(transformer.slugify('  --Hello World--  ').output).toBe('hello-world')
    })

    it('empty input produces an empty slug without throwing', () => {
      expect(transformer.slugify('').output).toBe('')
    })
  })

  describe('line operations', () => {
    const runner = new LineOperationRunner()

    it('sort — ascending lexicographic', () => {
      const result = runner.execute({ text: 'banana\napple\ncherry', operation: 'sort' })
      expect(result.output).toBe('apple\nbanana\ncherry')
    })

    it('sort — descending', () => {
      const result = runner.execute({ text: 'banana\napple\ncherry', operation: 'sort', descending: true })
      expect(result.output).toBe('cherry\nbanana\napple')
    })

    it('sort — case-insensitive treats "Apple" and "banana" fairly', () => {
      const result = runner.execute({ text: 'banana\nApple\ncherry', operation: 'sort', caseInsensitive: true })
      expect(result.output).toBe('Apple\nbanana\ncherry')
    })

    it('sort — natural order puts item2 before item10', () => {
      const result = runner.execute({ text: 'item10\nitem2\nitem1', operation: 'sort', natural: true })
      expect(result.output).toBe('item1\nitem2\nitem10')
    })

    it('sort — without natural order, item10 sorts before item2 lexicographically', () => {
      const result = runner.execute({ text: 'item10\nitem2', operation: 'sort' })
      expect(result.output).toBe('item10\nitem2')
    })

    it('deduplicate — keeps first occurrence, drops later repeats', () => {
      const result = runner.execute({ text: 'a\nb\na\nc\nb', operation: 'deduplicate' })
      expect(result.output).toBe('a\nb\nc')
    })

    it('deduplicate — case-insensitive treats "A" and "a" as duplicates', () => {
      const result = runner.execute({ text: 'a\nA\nb', operation: 'deduplicate', caseInsensitive: true })
      expect(result.output).toBe('a\nb')
    })

    it('reverse — reverses line order', () => {
      const result = runner.execute({ text: 'one\ntwo\nthree', operation: 'reverse' })
      expect(result.output).toBe('three\ntwo\none')
    })

    it('trim — trims leading/trailing whitespace from each line', () => {
      const result = runner.execute({ text: '  hi  \n\tthere\t', operation: 'trim' })
      expect(result.output).toBe('hi\nthere')
    })

    it('removeBlank — drops blank/whitespace-only lines', () => {
      const result = runner.execute({ text: 'a\n\n  \nb\n', operation: 'removeBlank' })
      expect(result.output).toBe('a\nb')
    })

    it('number — adds sequential, right-aligned numbers by default', () => {
      const result = runner.execute({ text: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj', operation: 'number' })
      const lines = result.output.split('\n')
      expect(lines[0]).toBe(' 1. a')
      expect(lines[lines.length - 1]).toBe('10. j')
    })

    it('number — custom start and separator, no padding', () => {
      const result = runner.execute({
        text: 'a\nb',
        operation: 'number',
        startNumber: 5,
        numberSeparator: ') ',
        padNumbers: false,
      })
      expect(result.output).toBe('5) a\n6) b')
    })

    it('splitLines drops a single trailing empty line from a trailing newline', () => {
      expect(LineOperationRunner.splitLines('a\nb\n')).toEqual(['a', 'b'])
    })

    it('splitLines handles CRLF and CR alike', () => {
      expect(LineOperationRunner.splitLines('a\r\nb\rc')).toEqual(['a', 'b', 'c'])
    })

    it('empty input for a line operation returns empty output without throwing', () => {
      const result = runner.execute({ text: '', operation: 'sort' })
      expect(result.output).toBe('')
      expect(result.lineCount).toBe(0)
    })
  })

  describe('empty input handled without throwing for every mode', () => {
    it('case conversion of empty text yields empty output', () => {
      for (const target of TEXT_CASES) {
        expect(() => transformer.convertCase('', target)).not.toThrow()
        expect(transformer.convertCase('', target).output).toBe('')
      }
    })

    it('slugify of empty text yields empty output', () => {
      expect(() => transformer.slugify('')).not.toThrow()
    })

    it('every line operation on empty text yields empty output', () => {
      const runner = new LineOperationRunner()
      for (const op of LINE_OPERATIONS) {
        const result = runner.execute({ text: '', operation: op })
        expect(result.output).toBe('')
        expect(result.lineCount).toBe(0)
      }
    })
  })
})
