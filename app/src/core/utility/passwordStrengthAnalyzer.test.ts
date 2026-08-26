import { describe, expect, it } from 'vitest'
import { PasswordStrengthAnalyzer, passwordStrengthRatingIndex } from './passwordStrengthAnalyzer'

describe('PasswordStrengthAnalyzer', () => {
  const analyzer = new PasswordStrengthAnalyzer()

  it('rates an obviously weak short password as weak', () => {
    const result = analyzer.execute({ password: 'abc' })
    expect(result.rating).toBe('weak')
  })

  it('rates an obviously strong long mixed-charset password highly', () => {
    const result = analyzer.execute({ password: 'aB3!xQ9$zP2#Lm7^Rt5&Wc8@' })
    expect(['strong', 'veryStrong']).toContain(result.rating)
  })

  it('rating ordering: weak password scores lower than strong password', () => {
    const weak = analyzer.execute({ password: 'abc' })
    const strong = analyzer.execute({ password: 'aB3!xQ9$zP2#Lm7^Rt5&Wc8@' })
    expect(weak.entropyBits).toBeLessThan(strong.entropyBits)
    expect(passwordStrengthRatingIndex(weak.rating)).toBeLessThan(passwordStrengthRatingIndex(strong.rating))
  })

  it('empty password is weak with zero entropy', () => {
    const result = analyzer.execute({ password: '' })
    expect(result.entropyBits).toBe(0)
    expect(result.rating).toBe('weak')
  })

  it('longer passwords of the same charset never score lower', () => {
    const shorter = analyzer.execute({ password: 'aaaa' })
    const longer = analyzer.execute({ password: 'aaaaaaaa' })
    expect(longer.entropyBits).toBeGreaterThan(shorter.entropyBits)
  })

  it('adding character classes increases entropy for equal length', () => {
    const lowerOnly = analyzer.execute({ password: 'abcdefgh' })
    const mixed = analyzer.execute({ password: 'aB3defg!' })
    expect(mixed.entropyBits).toBeGreaterThan(lowerOnly.entropyBits)
  })
})
