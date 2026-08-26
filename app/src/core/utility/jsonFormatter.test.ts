import { describe, expect, it } from 'vitest'
import { JsonFormatter } from './jsonFormatter'

describe('JsonFormatter', () => {
  const formatter = new JsonFormatter()

  it('pretty-prints with two-space indent', () => {
    const result = formatter.execute({ source: '{"a":1,"b":[1,2]}', mode: 'pretty' })

    expect(result.isValid).toBe(true)
    expect(result.output).toContain('\n')
    expect(result.output).toContain('  "a": 1')
    expect(JSON.parse(result.output!)).toEqual({ a: 1, b: [1, 2] })
  })

  it('minifies whitespace out of formatted JSON', () => {
    const result = formatter.execute({
      source: '{\n  "a" : 1,\n  "b" : [1, 2]\n}',
      mode: 'minify',
    })

    expect(result.isValid).toBe(true)
    expect(result.output).toBe('{"a":1,"b":[1,2]}')
  })

  it('validate reports valid JSON without altering it', () => {
    const result = formatter.execute({ source: '{"a":1}', mode: 'validate' })

    expect(result.isValid).toBe(true)
  })

  it('rejects malformed JSON with an error message', () => {
    const result = formatter.execute({ source: '{"a":1,}', mode: 'validate' })

    expect(result.isValid).toBe(false)
    expect(result.errorMessage).not.toBeNull()
    expect(result.output).toBeUndefined()
  })
})
