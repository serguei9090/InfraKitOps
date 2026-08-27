import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { YamlFormatter } from './yamlFormatter'

describe('YamlFormatter', () => {
  const formatter = new YamlFormatter()

  it('pretty-prints a map with a nested list at the standard 2-space indent', () => {
    const result = formatter.execute({ source: 'a: 1\nb:\n  - x\n  - y\n', mode: 'pretty' })

    expect(result.isValid).toBe(true)
    expect(result.output).toBe('a: 1\nb:\n  - x\n  - y')
  })

  it('honors a custom indent size', () => {
    const result = formatter.execute({ source: 'a:\n  b: 1\n', mode: 'pretty', indentSize: 4 })

    expect(result.isValid).toBe(true)
    expect(result.output).toBe('a:\n    b: 1')
  })

  it('pretty-printing preserves the same data js-yaml reads back (round trip, not just formatting)', () => {
    const source = 'server:\n  host: localhost\n  port: 8080\n  flags:\n    - a\n    - b\n'
    const result = formatter.execute({ source, mode: 'pretty' })

    expect(load(result.output!)).toEqual(load(source))
  })

  it('minifies to single-line flow style', () => {
    const result = formatter.execute({ source: 'a: 1\nb:\n  - x\n  - y\n', mode: 'minify' })

    expect(result.isValid).toBe(true)
    expect(result.output).toBe('{a: 1, b: [x, y]}')
  })

  it('minifying preserves the same data js-yaml reads back', () => {
    const source = 'server:\n  host: localhost\n  port: 8080\n'
    const result = formatter.execute({ source, mode: 'minify' })

    expect(load(result.output!)).toEqual(load(source))
  })

  it('validate reports valid YAML', () => {
    const result = formatter.execute({ source: 'a: 1', mode: 'validate' })

    expect(result.isValid).toBe(true)
  })

  it('rejects malformed YAML with an unclosed flow collection', () => {
    const result = formatter.execute({ source: 'foo: [1, 2', mode: 'validate' })

    expect(result.isValid).toBe(false)
    expect(result.errorMessage).not.toBeNull()
  })

  it('does not quote a plain string that merely looks like a YAML 1.1 boolean shorthand (y/n/yes/no)', () => {
    // CORE_SCHEMA (not the dumper's default) is what makes this not come
    // back quoted as "yes" -- pins the schema choice, not just the output.
    const result = formatter.execute({ source: 'answer: yes', mode: 'pretty' })

    expect(result.output).toBe('answer: yes')
    expect(load(result.output!)).toEqual({ answer: 'yes' })
  })
})
