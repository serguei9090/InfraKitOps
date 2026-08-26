import { describe, expect, it } from 'vitest'
import { WebEncoder } from './webEncoders'

describe('WebEncoder', () => {
  const encoder = new WebEncoder()

  it('URL-encodes reserved characters', () => {
    const result = encoder.execute({ text: 'a b&c=d', operation: 'urlEncode' })
    expect(result.output).toBe('a%20b%26c%3Dd')
  })

  it('URL-decodes percent sequences', () => {
    const result = encoder.execute({ text: 'a%20b%26c%3Dd', operation: 'urlDecode' })
    expect(result.output).toBe('a b&c=d')
  })

  it('rejects malformed percent-encoding', () => {
    expect(() => encoder.execute({ text: '100% done %', operation: 'urlDecode' })).toThrow()
  })

  it('escapes HTML special characters', () => {
    const result = encoder.execute({
      text: '<a href="x">Tom & Jerry\'s</a>',
      operation: 'htmlEscape',
    })
    expect(result.output).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;')
  })

  it('unescapes HTML entities including numeric ones', () => {
    const result = encoder.execute({
      text: '&lt;b&gt;Caf&#233; &amp; Bar&lt;/b&gt;',
      operation: 'htmlUnescape',
    })
    expect(result.output).toBe('<b>Café & Bar</b>')
  })
})
