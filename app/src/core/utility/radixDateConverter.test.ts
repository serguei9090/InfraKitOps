import { describe, expect, it } from 'vitest'
import { RadixConverter, RomanNumeralConverter, TimestampConverter } from './radixDateConverter'

describe('RadixConverter', () => {
  const converter = new RadixConverter()

  it('converts decimal to hexadecimal', () => {
    const result = converter.execute({ value: '255', fromBase: 'decimal', toBase: 'hexadecimal' })
    expect(result.value).toBe('ff')
  })

  it('converts hexadecimal to binary', () => {
    const result = converter.execute({ value: 'FF', fromBase: 'hexadecimal', toBase: 'binary' })
    expect(result.value).toBe('11111111')
  })

  it('rejects digits invalid for the source base', () => {
    expect(() =>
      converter.execute({ value: '102', fromBase: 'binary', toBase: 'decimal' }),
    ).toThrow()
  })
})

describe('RomanNumeralConverter', () => {
  const converter = new RomanNumeralConverter()

  it('converts decimal to Roman numerals', () => {
    const result = converter.execute({ value: '1994', operation: 'toRoman' })
    expect(result.value).toBe('MCMXCIV')
  })

  it('converts Roman numerals to decimal', () => {
    const result = converter.execute({ value: 'MCMXCIV', operation: 'toDecimal' })
    expect(result.value).toBe('1994')
  })

  it('rejects non-canonical Roman numerals', () => {
    expect(() => converter.execute({ value: 'IIII', operation: 'toDecimal' })).toThrow()
  })

  it('rejects out-of-range values', () => {
    expect(() => converter.execute({ value: '4000', operation: 'toRoman' })).toThrow()
  })
})

describe('TimestampConverter', () => {
  const converter = new TimestampConverter()

  it('converts epoch seconds to ISO-8601', () => {
    const result = converter.execute({ value: '0', direction: 'epochToIso', unit: 'seconds' })
    expect(result.value).toBe('1970-01-01T00:00:00.000Z')
  })

  it('converts ISO-8601 to epoch seconds', () => {
    const result = converter.execute({
      value: '2024-01-01T00:00:00Z',
      direction: 'isoToEpoch',
      unit: 'seconds',
    })
    expect(result.value).toBe('1704067200')
  })

  it('rejects an invalid ISO-8601 timestamp', () => {
    expect(() =>
      converter.execute({ value: 'not-a-date', direction: 'isoToEpoch', unit: 'seconds' }),
    ).toThrow()
  })
})
