import bcrypt from 'bcryptjs'
import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * bcrypt's log2 cost factor range, per the algorithm's own spec (also
 * enforced by bcryptjs's `genSaltSync`).
 */
export const BCRYPT_MIN_LOG_ROUNDS = 4
export const BCRYPT_MAX_LOG_ROUNDS = 31
export const BCRYPT_DEFAULT_LOG_ROUNDS = 10

export interface BcryptHashInput {
  plaintext: string
  /** Log2 number of hashing rounds (cost factor). Higher is slower/safer. */
  logRounds?: number
}

export interface BcryptHashResult {
  /**
   * The full bcrypt-encoded hash string (prefix + cost + salt + digest),
   * e.g. `$2b$10$....`. Note: bcryptjs (unlike Dart's `bcrypt` package)
   * emits the `$2b$` prefix rather than `$2a$` — both are the same
   * algorithm, just different minor-version markers, and bcryptjs verifies
   * `$2a$`/`$2b$`/`$2y$` hashes interchangeably.
   */
  hash: string
}

/**
 * Generates a salted bcrypt hash for a plaintext password/secret.
 *
 * bcrypt is one-way and self-salting: unlike MD5/SHA/SHA3 it never produces
 * a stable digest for a given input (a fresh random salt is drawn every
 * call), and it can't be "checked" by recomputing and comparing hex strings
 * directly — hence it gets its own use case rather than being lumped into
 * `HashCalculator`.
 */
export class BcryptHasher implements IToolUseCase<BcryptHashInput, BcryptHashResult> {
  execute(input: BcryptHashInput): BcryptHashResult {
    const logRounds = input.logRounds ?? BCRYPT_DEFAULT_LOG_ROUNDS
    if (logRounds < BCRYPT_MIN_LOG_ROUNDS || logRounds > BCRYPT_MAX_LOG_ROUNDS) {
      throw new Error(
        `logRounds must be between ${BCRYPT_MIN_LOG_ROUNDS} and ${BCRYPT_MAX_LOG_ROUNDS} (got ${logRounds})`,
      )
    }
    const salt = bcrypt.genSaltSync(logRounds)
    return { hash: bcrypt.hashSync(input.plaintext, salt) }
  }
}

export interface BcryptVerifyInput {
  plaintext: string
  /** A previously generated bcrypt hash string to check against. */
  hash: string
}

export interface BcryptVerifyResult {
  matches: boolean
}

/**
 * Verifies a plaintext against a previously generated bcrypt hash by
 * recomputing bcrypt with the salt embedded in that hash and comparing.
 */
export class BcryptVerifier implements IToolUseCase<BcryptVerifyInput, BcryptVerifyResult> {
  execute(input: BcryptVerifyInput): BcryptVerifyResult {
    try {
      return { matches: bcrypt.compareSync(input.plaintext, input.hash) }
    } catch {
      return { matches: false }
    }
  }
}
