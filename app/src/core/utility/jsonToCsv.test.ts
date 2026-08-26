import { describe, expect, it } from 'vitest'
import { escapeCsvField, JsonToCsvConverter } from './jsonToCsv'

describe('JsonToCsvConverter', () => {
  const converter = new JsonToCsvConverter()

  describe('header union across differing key sets', () => {
    it('objects with different keys union into one header, first-seen order, empty cells for missing keys', () => {
      const json = '[{"a": 1, "b": 2}, {"b": 3, "c": 4}]'

      const result = converter.execute({ json })

      expect(result.headers).toEqual(['a', 'b', 'c'])
      expect(result.rowCount).toBe(2)

      const lines = result.csv.split('\r\n').filter((l) => l.length > 0)
      expect(lines[0]).toBe('a,b,c')
      expect(lines[1]).toBe('1,2,') // row 1 has no "c"
      expect(lines[2]).toBe(',3,4') // row 2 has no "a"
    })
  })

  describe('nested object flattening', () => {
    it('nested objects flatten to dotted paths', () => {
      const json = '[{"user": {"name": "Ann", "age": 30}}, {"user": {"name": "Bo", "age": 41}}]'

      const result = converter.execute({ json })

      expect(result.headers).toEqual(['user.name', 'user.age'])
      const lines = result.csv.split('\r\n').filter((l) => l.length > 0)
      expect(lines[0]).toBe('user.name,user.age')
      expect(lines[1]).toBe('Ann,30')
      expect(lines[2]).toBe('Bo,41')
    })

    it('deeply nested objects flatten through multiple levels', () => {
      const json = '[{"a": {"b": {"c": 1}}}]'
      const result = converter.execute({ json })
      expect(result.headers).toEqual(['a.b.c'])
    })

    it('empty nested object contributes no columns', () => {
      const json = '[{"a": 1, "b": {}}]'
      const result = converter.execute({ json })
      expect(result.headers).toEqual(['a'])
    })

    it('null values become empty cells', () => {
      const json = '[{"a": null}]'
      const result = converter.execute({ json })
      // Header row "a", then one data row that is a single empty cell —
      // the row itself is an empty string before its line ending, so a
      // blanket "remove empty lines" filter would wrongly eat it.
      expect(result.csv).toBe('a\r\n\r\n')
    })
  })

  describe('array handling', () => {
    it('default index-suffixed columns for nested arrays', () => {
      const json = '[{"tags": ["a", "b"]}]'
      const result = converter.execute({ json })
      expect(result.headers).toEqual(['tags.0', 'tags.1'])
      const lines = result.csv.split('\r\n').filter((l) => l.length > 0)
      expect(lines[1]).toBe('a,b')
    })

    it('objects inside arrays keep flattening with indexed columns', () => {
      const json = '[{"users": [{"name": "x"}]}]'
      const result = converter.execute({ json })
      expect(result.headers).toEqual(['users.0.name'])
    })

    it('JSON-encoded array handling keeps the array in one cell', () => {
      const json = '[{"tags": ["a", "b"]}]'
      const result = converter.execute({ json, arrayHandling: 'jsonEncoded' })
      expect(result.headers).toEqual(['tags'])
      const lines = result.csv.split('\r\n').filter((l) => l.length > 0)
      // The cell holds the compact JSON of the array; it contains a comma
      // and must therefore be quoted per RFC 4180.
      expect(lines[1]).toBe('"[""a"",""b""]"')
    })

    it('empty array contributes no columns', () => {
      const json = '[{"a": 1, "tags": []}]'
      const result = converter.execute({ json })
      expect(result.headers).toEqual(['a'])
    })
  })

  describe('RFC 4180 quoting', () => {
    it('a field with comma, double quote AND newline is escaped exactly per RFC 4180', () => {
      // Field value: He said "hi, there"\nBye
      const value = 'He said "hi, there"\nBye'

      const result = converter.execute({ json: `[{"note": ${JSON.stringify(value)}}]` })

      // The field's internal newline is preserved as-is (LF, from the
      // source value) inside the quotes; only the embedded double quotes
      // are doubled. The \r\n after the closing quote is the row's own
      // line ending (CRLF, the default per RFC 4180), not part of escaping.
      const expectedEscaped = '"He said ""hi, there""\nBye"'
      expect(result.csv).toBe(`note\r\n${expectedEscaped}\r\n`)
    })

    it('escapeCsvField quotes a field containing the delimiter', () => {
      expect(escapeCsvField('a,b', ',')).toBe('"a,b"')
    })

    it('escapeCsvField quotes and doubles embedded double quotes', () => {
      expect(escapeCsvField('say "hi"', ',')).toBe('"say ""hi"""')
    })

    it('escapeCsvField quotes a field containing a newline', () => {
      expect(escapeCsvField('line1\nline2', ',')).toBe('"line1\nline2"')
    })

    it('escapeCsvField quotes a field containing a carriage return', () => {
      expect(escapeCsvField('a\rb', ',')).toBe('"a\rb"')
    })

    it('escapeCsvField leaves a plain field bare', () => {
      expect(escapeCsvField('plain', ',')).toBe('plain')
    })

    it('escapeCsvField only quotes for the active delimiter, not other punctuation', () => {
      // A comma inside a field must NOT force quoting when the delimiter is
      // a semicolon.
      expect(escapeCsvField('a,b', ';')).toBe('a,b')
      expect(escapeCsvField('a;b', ';')).toBe('"a;b"')
    })
  })

  describe('configurable delimiter', () => {
    it('semicolon delimiter is used for both header and rows', () => {
      const json = '[{"a": 1, "b": 2}]'
      const result = converter.execute({ json, delimiter: 'semicolon' })
      const lines = result.csv.split('\r\n').filter((l) => l.length > 0)
      expect(lines[0]).toBe('a;b')
      expect(lines[1]).toBe('1;2')
    })

    it('tab delimiter is used for both header and rows', () => {
      const json = '[{"a": 1, "b": 2}]'
      const result = converter.execute({ json, delimiter: 'tab' })
      const lines = result.csv.split('\r\n').filter((l) => l.length > 0)
      expect(lines[0]).toBe('a\tb')
      expect(lines[1]).toBe('1\t2')
    })
  })

  describe('line ending option', () => {
    it('LF line ending produces \\n separated lines with no \\r', () => {
      const json = '[{"a": 1}]'
      const result = converter.execute({ json, lineEnding: 'lf' })
      expect(result.csv.includes('\r')).toBe(false)
      expect(result.csv).toBe('a\n1\n')
    })
  })

  describe('header option', () => {
    it('includeHeader: false omits the header row', () => {
      const json = '[{"a": 1}, {"a": 2}]'
      const result = converter.execute({ json, includeHeader: false })
      expect(result.csv).toBe('1\r\n2\r\n')
    })
  })

  describe('error handling', () => {
    it('empty input is rejected', () => {
      expect(() => converter.execute({ json: '   ' })).toThrow()
    })

    it('invalid JSON throws a clean error', () => {
      expect(() => converter.execute({ json: '{not json' })).toThrow()
    })

    it('a top-level JSON object (not array) is rejected', () => {
      expect(() => converter.execute({ json: '{"a": 1}' })).toThrow(/array of objects/)
    })

    it('a top-level JSON scalar is rejected', () => {
      expect(() => converter.execute({ json: '42' })).toThrow()
    })

    it('an empty JSON array is rejected', () => {
      expect(() => converter.execute({ json: '[]' })).toThrow()
    })

    it('an array element that is not an object is rejected with a clear message', () => {
      expect(() => converter.execute({ json: '[{"a": 1}, "oops"]' })).toThrow(/Element 2/)
    })
  })
})
