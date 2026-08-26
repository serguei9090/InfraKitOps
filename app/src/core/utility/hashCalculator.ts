import CryptoJS from 'crypto-js'
import type { IToolUseCase } from '../ports/IToolUseCase'

/** One computed digest, paired with a human-readable label for display. */
export interface HashDigestResult {
  /** e.g. "MD5", "SHA-256", "HMAC-SHA-512". */
  algorithmLabel: string
  /** Lowercase hexadecimal digest. */
  hex: string
}

export interface HashCalculatorInput {
  /** The plaintext (UTF-8 encoded) to hash. */
  text: string
  /**
   * Optional secret key. When non-null and non-empty, HMAC variants of
   * MD5/SHA-1/SHA-256/SHA-512 are also computed.
   */
  hmacSecretKey?: string
}

export interface HashCalculatorResult {
  /** Plain (unkeyed) digests: MD5, SHA-1, SHA-256, SHA-512, SHA3-512. */
  digests: HashDigestResult[]
  /**
   * HMAC digests keyed by `HashCalculatorInput.hmacSecretKey`. Empty when no
   * secret key was supplied.
   */
  hmacDigests: HashDigestResult[]
}

/**
 * Computes MD5 / SHA-1 / SHA-256 / SHA-512 / SHA3-512 digests for a text
 * input, plus the HMAC variant of each non-SHA3 algorithm when a secret key
 * is given.
 *
 * Ported from `lib/core/utility/hash_calculator.dart`, which used
 * `package:crypto` for MD5/SHA-1/SHA-256/SHA-512 and `package:hashlib` for a
 * fifth digest, BLAKE2b-512. `crypto-js` (the package this batch is
 * restricted to) has no BLAKE2b implementation, so that fifth slot is
 * substituted here with SHA3-512 (crypto-js's `SHA3` defaults to a 512-bit
 * output) — same "fifth, more exotic digest" role, different algorithm. This
 * is a deliberate, flagged substitution, not an oversight.
 *
 * Pure TS, zero I/O, zero React — lives in the core so it is unit-testable
 * in milliseconds and reusable by any UI adapter.
 */
export class HashCalculator implements IToolUseCase<HashCalculatorInput, HashCalculatorResult> {
  execute(input: HashCalculatorInput): HashCalculatorResult {
    const digests: HashDigestResult[] = [
      { algorithmLabel: 'MD5', hex: CryptoJS.MD5(input.text).toString(CryptoJS.enc.Hex) },
      { algorithmLabel: 'SHA-1', hex: CryptoJS.SHA1(input.text).toString(CryptoJS.enc.Hex) },
      { algorithmLabel: 'SHA-256', hex: CryptoJS.SHA256(input.text).toString(CryptoJS.enc.Hex) },
      { algorithmLabel: 'SHA-512', hex: CryptoJS.SHA512(input.text).toString(CryptoJS.enc.Hex) },
      { algorithmLabel: 'SHA3-512', hex: CryptoJS.SHA3(input.text).toString(CryptoJS.enc.Hex) },
    ]

    const secret = input.hmacSecretKey
    const hmacDigests: HashDigestResult[] = []
    if (secret != null && secret.length > 0) {
      hmacDigests.push(
        { algorithmLabel: 'HMAC-MD5', hex: CryptoJS.HmacMD5(input.text, secret).toString(CryptoJS.enc.Hex) },
        { algorithmLabel: 'HMAC-SHA-1', hex: CryptoJS.HmacSHA1(input.text, secret).toString(CryptoJS.enc.Hex) },
        {
          algorithmLabel: 'HMAC-SHA-256',
          hex: CryptoJS.HmacSHA256(input.text, secret).toString(CryptoJS.enc.Hex),
        },
        {
          algorithmLabel: 'HMAC-SHA-512',
          hex: CryptoJS.HmacSHA512(input.text, secret).toString(CryptoJS.enc.Hex),
        },
      )
    }

    return { digests, hmacDigests }
  }
}
