import { describe, expect, it } from 'vitest'
import { PassphraseGenerator, PasswordGenerator, passphraseWordList } from './passwordGenerator'

describe('PasswordGenerator', () => {
  const generator = new PasswordGenerator()

  it('produces a password of the requested length', () => {
    const result = generator.execute({ length: 24 })
    expect(result.password).toHaveLength(24)
  })

  it('only uses digits when only digits are enabled', () => {
    const result = generator.execute({
      length: 32,
      includeUppercase: false,
      includeLowercase: false,
      includeDigits: true,
      includeSymbols: false,
    })
    expect(result.password).toMatch(/^[0-9]+$/)
  })

  it('only uses lowercase letters when only lowercase is enabled', () => {
    const result = generator.execute({
      length: 32,
      includeUppercase: false,
      includeLowercase: true,
      includeDigits: false,
      includeSymbols: false,
    })
    expect(result.password).toMatch(/^[a-z]+$/)
  })

  it('generates distinct passwords across calls', () => {
    const a = generator.execute({ length: 20 })
    const b = generator.execute({ length: 20 })
    expect(a.password).not.toBe(b.password)
  })

  it('throws when length is not positive', () => {
    expect(() => generator.execute({ length: 0 })).toThrow()
  })

  it('throws when no character set is enabled', () => {
    expect(() =>
      generator.execute({
        length: 10,
        includeUppercase: false,
        includeLowercase: false,
        includeDigits: false,
        includeSymbols: false,
      }),
    ).toThrow()
  })
})

describe('PassphraseGenerator', () => {
  const generator = new PassphraseGenerator()

  it('produces the requested number of words joined by the separator', () => {
    const result = generator.execute({ wordCount: 5, separator: '-' })
    const segments = result.passphrase.split('-')
    expect(segments).toHaveLength(5)
    for (const segment of segments) {
      expect(passphraseWordList).toContain(segment)
    }
  })

  it('capitalizes words when requested', () => {
    const result = generator.execute({ wordCount: 4, separator: '-', capitalizeWords: true })
    for (const segment of result.passphrase.split('-')) {
      expect(segment[0]).toBe(segment[0].toUpperCase())
    }
  })

  it('appends a numeric segment when includeNumber is true', () => {
    const result = generator.execute({ wordCount: 3, separator: '-', includeNumber: true })
    const segments = result.passphrase.split('-')
    expect(segments).toHaveLength(4)
    expect(Number.isNaN(Number(segments.at(-1)))).toBe(false)
  })

  it('respects a custom separator', () => {
    const result = generator.execute({ wordCount: 3, separator: '_' })
    expect(result.passphrase.split('_')).toHaveLength(3)
    expect(result.passphrase).not.toContain('-')
  })

  it('throws when wordCount is not positive', () => {
    expect(() => generator.execute({ wordCount: 0 })).toThrow()
  })

  it('word list has a few hundred unique words', () => {
    expect(passphraseWordList.length).toBeGreaterThanOrEqual(200)
    expect(new Set(passphraseWordList).size).toBe(passphraseWordList.length)
  })
})
