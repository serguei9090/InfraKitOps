import type { IToolUseCase } from '../ports/IToolUseCase'

export type NumberBase = 'binary' | 'octal' | 'decimal' | 'hexadecimal'

const RADIX: Record<NumberBase, number> = {
  binary: 2,
  octal: 8,
  decimal: 10,
  hexadecimal: 16,
}

export interface RadixConversionInput {
  value: string
  fromBase: NumberBase
  toBase: NumberBase
}

export interface RadixConversionResult {
  value: string
}

const DIGIT_VALUE: Record<string, number> = Object.fromEntries(
  '0123456789abcdefghijklmnopqrstuvwxyz'.split('').map((c, i) => [c, i]),
)

function parseBigIntRadix(value: string, radix: number): bigint | null {
  let negative = false
  let rest = value
  if (rest.startsWith('-')) {
    negative = true
    rest = rest.slice(1)
  } else if (rest.startsWith('+')) {
    rest = rest.slice(1)
  }
  if (rest.length === 0) return null

  let result = 0n
  const bigRadix = BigInt(radix)
  for (const ch of rest.toLowerCase()) {
    const digit = DIGIT_VALUE[ch]
    if (digit === undefined || digit >= radix) return null
    result = result * bigRadix + BigInt(digit)
  }
  return negative ? -result : result
}

/**
 * Converts non-negative integers between binary, octal, decimal and
 * hexadecimal. Uses `bigint` rather than `number` so arbitrarily large
 * hex/binary values (beyond 64-bit) still round-trip correctly.
 */
export class RadixConverter implements IToolUseCase<RadixConversionInput, RadixConversionResult> {
  execute(input: RadixConversionInput): RadixConversionResult {
    const cleaned = input.value.trim()
    if (cleaned.length === 0) {
      throw new Error('Input is empty')
    }

    const fromRadix = RADIX[input.fromBase]
    const parsed = parseBigIntRadix(cleaned, fromRadix)
    if (parsed === null) {
      throw new Error(`"${cleaned}" is not a valid base ${fromRadix} number`)
    }

    if (parsed < 0n) {
      throw new Error('Negative numbers are not supported')
    }

    return { value: parsed.toString(RADIX[input.toBase]) }
  }
}

export type RomanNumeralOperation = 'toRoman' | 'toDecimal'

export interface RomanNumeralInput {
  value: string
  operation: RomanNumeralOperation
}

export interface RomanNumeralResult {
  value: string
}

const ROMAN_VALUES = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1]
const ROMAN_SYMBOLS = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I']
const ROMAN_DIGIT_VALUES: Record<string, number> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
  D: 500,
  M: 1000,
}

function parseStrictInt(value: string): number | null {
  if (!/^-?\d+$/.test(value)) return null
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : null
}

function toRoman(value: string): string {
  if (value.length === 0) {
    throw new Error('Input is empty')
  }
  const n = parseStrictInt(value)
  if (n === null) {
    throw new Error(`"${value}" is not a valid integer`)
  }
  if (n < 1 || n > 3999) {
    throw new Error('Roman numerals only support values from 1 to 3999')
  }

  let remaining = n
  let result = ''
  for (let i = 0; i < ROMAN_VALUES.length; i++) {
    while (remaining >= ROMAN_VALUES[i]!) {
      remaining -= ROMAN_VALUES[i]!
      result += ROMAN_SYMBOLS[i]
    }
  }
  return result
}

function toDecimal(value: string): string {
  if (value.length === 0) {
    throw new Error('Input is empty')
  }
  const normalized = value.toUpperCase()

  let total = 0
  for (let i = 0; i < normalized.length; i++) {
    const current = ROMAN_DIGIT_VALUES[normalized[i]!]
    if (current === undefined) {
      throw new Error(`"${normalized[i]}" is not a valid Roman numeral character`)
    }
    const next = i + 1 < normalized.length ? ROMAN_DIGIT_VALUES[normalized[i + 1]!] : undefined
    if (next !== undefined && current < next) {
      total -= current
    } else {
      total += current
    }
  }

  // Reject non-canonical forms (e.g. "IIII", "VX") by re-rendering the
  // computed value and requiring it to match the input exactly.
  if (total < 1 || total > 3999 || toRoman(total.toString()) !== normalized) {
    throw new Error(`"${value}" is not a valid Roman numeral`)
  }

  return total.toString()
}

/**
 * Roman numeral <-> decimal, hand-rolled with the standard subtractive
 * notation (values 1-3999, the classically representable range).
 */
export class RomanNumeralConverter implements IToolUseCase<RomanNumeralInput, RomanNumeralResult> {
  execute(input: RomanNumeralInput): RomanNumeralResult {
    switch (input.operation) {
      case 'toRoman':
        return { value: toRoman(input.value.trim()) }
      case 'toDecimal':
        return { value: toDecimal(input.value.trim()) }
    }
  }
}

export type EpochUnit = 'seconds' | 'milliseconds'

export type TimestampDirection = 'epochToIso' | 'isoToEpoch'

export interface TimestampConversionInput {
  value: string
  direction: TimestampDirection
  unit: EpochUnit
}

export interface TimestampConversionResult {
  value: string
}

function epochToIso(value: string, unit: EpochUnit): string {
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`"${value}" is not a valid integer epoch value`)
  }
  const n = Number(value)
  const milliseconds = unit === 'seconds' ? n * 1000 : n
  return new Date(milliseconds).toISOString()
}

function isoToEpoch(value: string, unit: EpochUnit): string {
  const milliseconds = Date.parse(value)
  if (Number.isNaN(milliseconds)) {
    throw new Error(`"${value}" is not a valid ISO-8601 timestamp`)
  }
  const result = unit === 'seconds' ? Math.round(milliseconds / 1000) : milliseconds
  return result.toString()
}

/**
 * Unix epoch <-> ISO-8601, always normalized through UTC so the result does
 * not depend on the host machine's local time zone.
 */
export class TimestampConverter
  implements IToolUseCase<TimestampConversionInput, TimestampConversionResult>
{
  execute(input: TimestampConversionInput): TimestampConversionResult {
    const trimmed = input.value.trim()
    if (trimmed.length === 0) {
      throw new Error('Input is empty')
    }

    switch (input.direction) {
      case 'epochToIso':
        return { value: epochToIso(trimmed, input.unit) }
      case 'isoToEpoch':
        return { value: isoToEpoch(trimmed, input.unit) }
    }
  }
}
