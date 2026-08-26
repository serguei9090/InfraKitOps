import { describe, expect, it } from 'vitest'
import { XmlFormatter } from './xmlFormatter'

describe('XmlFormatter', () => {
  const formatter = new XmlFormatter()

  it('pretty-prints nested elements with indentation', () => {
    const result = formatter.execute({
      source: '<root><a>1</a><b>2</b></root>',
      mode: 'pretty',
    })

    expect(result.isValid).toBe(true)
    expect(result.output).toContain('\n')
    expect(result.output).toContain('  <a>1</a>')
    expect(result.output).toContain('  <b>2</b>')
  })

  it('minifies away insignificant whitespace between tags', () => {
    const result = formatter.execute({
      source: '<root>\n  <a>1</a>\n  <b>2</b>\n</root>',
      mode: 'minify',
    })

    expect(result.isValid).toBe(true)
    expect(result.output).toBe('<root><a>1</a><b>2</b></root>')
  })

  it('validate reports valid XML', () => {
    const result = formatter.execute({ source: '<root/>', mode: 'validate' })

    expect(result.isValid).toBe(true)
  })

  it('rejects malformed XML with mismatched tags', () => {
    const result = formatter.execute({ source: '<root><a></root>', mode: 'validate' })

    expect(result.isValid).toBe(false)
    expect(result.errorMessage).not.toBeNull()
  })
})
