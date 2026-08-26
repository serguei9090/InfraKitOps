import { describe, expect, it } from 'vitest'
import { Base64Converter } from './base64Converter'

describe('Base64Converter', () => {
  const converter = new Base64Converter()

  it('encodes text to Base64', () => {
    const result = converter.execute({ text: 'InfraKit Studio', operation: 'encode' })
    expect(result.output).toBe('SW5mcmFLaXQgU3R1ZGlv')
  })

  it('decodes Base64 back to text', () => {
    const result = converter.execute({ text: 'SW5mcmFLaXQgU3R1ZGlv', operation: 'decode' })
    expect(result.output).toBe('InfraKit Studio')
  })

  it('decodes Base64 pasted without padding', () => {
    const result = converter.execute({ text: 'SGVsbG8', operation: 'decode' })
    expect(result.output).toBe('Hello')
  })

  it('rejects invalid Base64 input', () => {
    expect(() =>
      converter.execute({ text: '@@@not base64@@@', operation: 'decode' }),
    ).toThrow()
  })

  it('rejects empty decode input', () => {
    expect(() => converter.execute({ text: '   ', operation: 'decode' })).toThrow()
  })
})
