import type { IToolUseCase } from '../ports/IToolUseCase'

/** Qualitative strength rating, ordered weakest to strongest. */
export type PasswordStrengthRating = 'weak' | 'fair' | 'strong' | 'veryStrong'

/** Ordering index matching the Dart enum's `.index`, weakest to strongest. */
const RATING_ORDER: PasswordStrengthRating[] = ['weak', 'fair', 'strong', 'veryStrong']

export function passwordStrengthRatingIndex(rating: PasswordStrengthRating): number {
  return RATING_ORDER.indexOf(rating)
}

export interface PasswordStrengthInput {
  password: string
}

export interface PasswordStrengthResult {
  /** Estimated entropy in bits: length * log2(character-set size). */
  entropyBits: number
  rating: PasswordStrengthRating
}

const LOWERCASE_POOL_SIZE = 26
const UPPERCASE_POOL_SIZE = 26
const DIGIT_POOL_SIZE = 10
// Common symbol pool as used on standard keyboards: !"#$%&'()*+,-./:;<=>?@
// [\]^_`{|}~ plus space -- 33 characters is a widely used estimate.
const SYMBOL_POOL_SIZE = 33

const LOWERCASE_PATTERN = /[a-z]/
const UPPERCASE_PATTERN = /[A-Z]/
const DIGIT_PATTERN = /[0-9]/
const SYMBOL_PATTERN = /[^a-zA-Z0-9]/

/**
 * Estimates password strength with a simple, defensible heuristic: entropy
 * bits = length * log2(character-set size), where the character-set size is
 * the sum of the classes (lowercase/uppercase/digits/symbols) actually
 * present in the password.
 *
 * This is intentionally not zxcvbn-grade -- it does not detect dictionary
 * words, keyboard patterns, or repetition -- but it gives a reasonable
 * order-of-magnitude estimate suitable for a UI strength meter.
 */
export class PasswordStrengthAnalyzer
  implements IToolUseCase<PasswordStrengthInput, PasswordStrengthResult>
{
  execute(input: PasswordStrengthInput): PasswordStrengthResult {
    const password = input.password
    if (password.length === 0) {
      return { entropyBits: 0, rating: 'weak' }
    }

    let poolSize = 0
    if (LOWERCASE_PATTERN.test(password)) poolSize += LOWERCASE_POOL_SIZE
    if (UPPERCASE_PATTERN.test(password)) poolSize += UPPERCASE_POOL_SIZE
    if (DIGIT_PATTERN.test(password)) poolSize += DIGIT_POOL_SIZE
    if (SYMBOL_PATTERN.test(password)) poolSize += SYMBOL_POOL_SIZE
    if (poolSize === 0) poolSize = 1

    const entropyBits = password.length * (Math.log(poolSize) / Math.log(2))

    return { entropyBits, rating: this.rate(entropyBits) }
  }

  private rate(entropyBits: number): PasswordStrengthRating {
    if (entropyBits < 28) return 'weak'
    if (entropyBits < 36) return 'fair'
    if (entropyBits < 60) return 'strong'
    return 'veryStrong'
  }
}
