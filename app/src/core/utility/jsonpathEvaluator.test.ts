import { describe, expect, it } from 'vitest'
import {
  jsonPathCompactValue,
  jsonPathMatchCount,
  jsonPathPrettyValue,
  jsonPathPrettyValues,
  JsonPathEvaluator,
  type JsonPathResult,
} from './jsonpathEvaluator'

describe('JsonPathEvaluator', () => {
  const evaluator = new JsonPathEvaluator()

  // Classic bookstore fixture used throughout JSONPath documentation/tests.
  const document = `
  {
    "store": {
      "book": [
        { "category": "reference", "author": "Nigel Rees", "title": "Sayings of the Century", "price": 8.95 },
        { "category": "fiction", "author": "Evelyn Waugh", "title": "Sword of Honour", "price": 12.99 },
        { "category": "fiction", "author": "Herman Melville", "title": "Moby Dick", "isbn": "0-553-21311-3", "price": 8.99 },
        { "category": "fiction", "author": "J. R. R. Tolkien", "title": "The Lord of the Rings", "isbn": "0-395-19395-8", "price": 22.99 }
      ],
      "bicycle": { "color": "red", "price": 19.95 }
    }
  }
  `

  function run(expression: string): JsonPathResult {
    return evaluator.execute({ document, expression })
  }

  describe('root and child access', () => {
    it('root alone returns the whole document', () => {
      const result = run('$')
      expect(result.isValid).toBe(true)
      expect(jsonPathMatchCount(result)).toBe(1)
      expect(result.matches[0].path).toBe('$')
    })

    it('dot child access walks nested objects', () => {
      const result = run('$.store.bicycle.color')
      expect(result.isValid).toBe(true)
      expect(jsonPathMatchCount(result)).toBe(1)
      expect(result.matches[0].value).toBe('red')
    })

    it('bracket child access with quoted name works, including keys needing quoting', () => {
      const result = run("$['store']['bicycle']['price']")
      expect(result.isValid).toBe(true)
      expect(result.matches[0].value).toBe(19.95)
    })
  })

  describe('wildcard', () => {
    it('.* returns every child of an object', () => {
      const result = run('$.store.bicycle.*')
      expect(result.isValid).toBe(true)
      expect(jsonPathMatchCount(result)).toBe(2)
      expect(result.matches.map((m) => m.value)).toEqual(expect.arrayContaining(['red', 19.95]))
    })

    it('[*] returns every element of an array', () => {
      const result = run('$.store.book[*].title')
      expect(result.isValid).toBe(true)
      expect(jsonPathMatchCount(result)).toBe(4)
      expect(result.matches.map((m) => m.value)).toEqual([
        'Sayings of the Century',
        'Sword of Honour',
        'Moby Dick',
        'The Lord of the Rings',
      ])
    })
  })

  describe('array index', () => {
    it('a positive index selects one element', () => {
      const result = run('$.store.book[0].title')
      expect(result.isValid).toBe(true)
      expect(result.matches[0].value).toBe('Sayings of the Century')
    })

    it('a negative index counts back from the end', () => {
      const result = run('$.store.book[-1].title')
      expect(result.isValid).toBe(true)
      expect(result.matches[0].value).toBe('The Lord of the Rings')
    })

    it('an out-of-range index yields no match rather than an error', () => {
      const result = run('$.store.book[99]')
      expect(result.isValid).toBe(true)
      expect(jsonPathMatchCount(result)).toBe(0)
    })
  })

  describe('slices', () => {
    it('a plain slice selects a sub-range', () => {
      const result = run('$.store.book[1:3].title')
      expect(result.isValid).toBe(true)
      expect(result.matches.map((m) => m.value)).toEqual(['Sword of Honour', 'Moby Dick'])
    })

    it('an open-ended slice with a negative bound counts from the end', () => {
      const result = run('$.store.book[-2:].title')
      expect(result.isValid).toBe(true)
      expect(result.matches.map((m) => m.value)).toEqual(['Moby Dick', 'The Lord of the Rings'])
    })

    it('a slice with a step skips elements', () => {
      const result = run('$.store.book[0:4:2].title')
      expect(result.isValid).toBe(true)
      expect(result.matches.map((m) => m.value)).toEqual(['Sayings of the Century', 'Moby Dick'])
    })

    it('a negative step walks backwards', () => {
      const result = run('$.store.book[::-1].title')
      expect(result.isValid).toBe(true)
      expect(result.matches.map((m) => m.value)).toEqual([
        'The Lord of the Rings',
        'Moby Dick',
        'Sword of Honour',
        'Sayings of the Century',
      ])
    })
  })

  describe('recursive descent', () => {
    it('..author finds matches at every depth', () => {
      const result = run('$..author')
      expect(result.isValid).toBe(true)
      expect(jsonPathMatchCount(result)).toBe(4)
      expect(result.matches.map((m) => m.value)).toEqual([
        'Nigel Rees',
        'Evelyn Waugh',
        'Herman Melville',
        'J. R. R. Tolkien',
      ])
    })

    it('..price finds prices nested at different depths (book array and bicycle)', () => {
      const result = run('$..price')
      expect(result.isValid).toBe(true)
      // 4 book prices + 1 bicycle price.
      expect(jsonPathMatchCount(result)).toBe(5)
      expect(result.matches.map((m) => m.value)).toEqual(expect.arrayContaining([8.95, 12.99, 8.99, 22.99, 19.95]))
    })

    it('..* returns every descendant value, deeper than one level', () => {
      const result = run('$.store.bicycle..*')
      expect(result.isValid).toBe(true)
      expect(result.matches.map((m) => m.value)).toEqual(expect.arrayContaining(['red', 19.95]))
    })

    it('..[0] applies a bracket selector to every descendant', () => {
      const result = run('$..[0]')
      expect(result.isValid).toBe(true)
      // The book array's [0] element (the Nigel Rees book) should be present.
      expect(
        result.matches.some(
          (m) => typeof m.value === 'object' && m.value !== null && (m.value as Record<string, unknown>)['author'] === 'Nigel Rees',
        ),
      ).toBe(true)
    })
  })

  describe('filters', () => {
    it('a numeric comparison filter selects matching array elements', () => {
      const result = run('$.store.book[?(@.price < 10)].title')
      expect(result.isValid).toBe(true)
      expect(result.matches.map((m) => m.value)).toEqual(['Sayings of the Century', 'Moby Dick'])
    })

    it('an equality filter compares against a string literal', () => {
      const result = run("$.store.book[?(@.category == 'fiction')].title")
      expect(result.isValid).toBe(true)
      expect(result.matches.map((m) => m.value)).toEqual(['Sword of Honour', 'Moby Dick', 'The Lord of the Rings'])
    })

    it('an existence filter selects elements that have the member', () => {
      const result = run('$.store.book[?(@.isbn)].title')
      expect(result.isValid).toBe(true)
      expect(result.matches.map((m) => m.value)).toEqual(['Moby Dick', 'The Lord of the Rings'])
    })

    it('a >= filter on price', () => {
      const result = run('$.store.book[?(@.price >= 12.99)].title')
      expect(result.isValid).toBe(true)
      expect(result.matches.map((m) => m.value)).toEqual(['Sword of Honour', 'The Lord of the Rings'])
    })
  })

  describe('unsupported / invalid syntax errors cleanly', () => {
    it('an expression not starting with $ is rejected', () => {
      const result = run('store.book')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).not.toBeUndefined()
    })

    it('boolean combinators in a filter are rejected with a clear message', () => {
      const result = run('$.store.book[?(@.price < 10 && @.category == "fiction")]')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toContain('&&')
    })

    it('regex filters are rejected', () => {
      const result = run('$.store.book[?(@.author =~ /Tolkien/)]')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toContain('=~')
    })

    it('union selectors are rejected', () => {
      const result = run('$.store.book[0,1]')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).not.toBeUndefined()
    })

    it('filter function calls are rejected', () => {
      const result = run('$.store.book[?(length(@.title) > 5)]')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).not.toBeUndefined()
    })

    it('script expressions are rejected', () => {
      const result = run('$.store.book[(@.length-1)]')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toContain('Script expressions')
    })

    it('an unclosed bracket is rejected', () => {
      const result = run('$.store.book[0')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).not.toBeUndefined()
    })
  })

  describe('invalid JSON document', () => {
    it('malformed JSON document errors cleanly', () => {
      const result = evaluator.execute({ document: '{"a": 1,}', expression: '$.a' })
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).not.toBeUndefined()
    })

    it('empty document errors cleanly', () => {
      const result = evaluator.execute({ document: '', expression: '$.a' })
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).not.toBeUndefined()
    })

    it('empty expression errors cleanly', () => {
      const result = evaluator.execute({ document, expression: '' })
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).not.toBeUndefined()
    })
  })

  describe('JsonPathMatch rendering helpers', () => {
    it('prettyValue and compactValue render the selected value as JSON', () => {
      const result = run('$.store.bicycle')
      const match = result.matches[0]
      expect(jsonPathPrettyValue(match)).toContain('"color": "red"')
      expect(jsonPathCompactValue(match)).toContain('"color":"red"')
    })

    it('prettyValues on the result renders all matches as a JSON array', () => {
      const result = run('$.store.book[0:2].title')
      expect(jsonPathPrettyValues(result)).toContain('Sayings of the Century')
      expect(jsonPathPrettyValues(result)).toContain('Sword of Honour')
    })
  })
})
