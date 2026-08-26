import { describe, expect, it } from 'vitest'
import { YamlFormatter } from './yamlFormatter'

describe('YamlFormatter', () => {
  const formatter = new YamlFormatter()

  it('pretty-prints a map with a nested list', () => {
    const result = formatter.execute({ source: 'a: 1\nb:\n  - x\n  - y\n', mode: 'pretty' })

    expect(result.isValid).toBe(true)
    expect(result.output).toBe('a: 1\nb:\n  - x\n  - y')
  })

  it('minifies to single-line flow style', () => {
    const result = formatter.execute({ source: 'a: 1\nb:\n  - x\n  - y\n', mode: 'minify' })

    expect(result.isValid).toBe(true)
    expect(result.output).toBe('{a: 1, b: [x, y]}')
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
})
