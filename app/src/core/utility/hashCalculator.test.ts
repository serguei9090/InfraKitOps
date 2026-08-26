import { describe, expect, it } from 'vitest'
import { HashCalculator, type HashDigestResult } from './hashCalculator'

/**
 * Looks up the digest with the given label, failing the test with a helpful
 * message if it's missing.
 */
function digestFor(digests: HashDigestResult[], label: string): string {
  const match = digests.filter((d) => d.algorithmLabel === label)
  expect(match, `expected exactly one "${label}" digest`).toHaveLength(1)
  return match[0].hex
}

describe('HashCalculator', () => {
  const calculator = new HashCalculator()

  describe('published known-answer test vectors', () => {
    it('MD5 of the empty string', () => {
      const result = calculator.execute({ text: '' })
      expect(digestFor(result.digests, 'MD5')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    })

    it('MD5 of "abc"', () => {
      const result = calculator.execute({ text: 'abc' })
      expect(digestFor(result.digests, 'MD5')).toBe('900150983cd24fb0d6963f7d28e17f72')
    })

    it('SHA-256 of the empty string', () => {
      const result = calculator.execute({ text: '' })
      expect(digestFor(result.digests, 'SHA-256')).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      )
    })

    it('SHA-256 of "abc"', () => {
      const result = calculator.execute({ text: 'abc' })
      expect(digestFor(result.digests, 'SHA-256')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      )
    })

    it('SHA-1 of "abc"', () => {
      const result = calculator.execute({ text: 'abc' })
      expect(digestFor(result.digests, 'SHA-1')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    })

    it('SHA-512 of "abc"', () => {
      const result = calculator.execute({ text: 'abc' })
      expect(digestFor(result.digests, 'SHA-512')).toBe(
        'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
          '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
      )
    })

    it('HMAC-MD5 with key "key" and message "The quick brown fox jumps over the lazy dog" (RFC 2202)', () => {
      const result = calculator.execute({
        text: 'The quick brown fox jumps over the lazy dog',
        hmacSecretKey: 'key',
      })
      expect(digestFor(result.hmacDigests, 'HMAC-MD5')).toBe('80070713463e7749b90c2dc24911e275')
    })

    it('HMAC-SHA-256 with key "key" and message "The quick brown fox jumps over the lazy dog"', () => {
      const result = calculator.execute({
        text: 'The quick brown fox jumps over the lazy dog',
        hmacSecretKey: 'key',
      })
      expect(digestFor(result.hmacDigests, 'HMAC-SHA-256')).toBe(
        'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
      )
    })
  })

  // Dart's reference implementation ships a fifth digest, BLAKE2b-512, via
  // `package:hashlib`. `crypto-js` (the package this TS port is restricted
  // to) has no BLAKE2b, so SHA3-512 stands in for it here — see the class
  // doc in hashCalculator.ts. These tests port the same *shape* of coverage
  // (deterministic, 512-bit, input-sensitive) against the substitute algorithm.
  describe('SHA3-512 (substitute for Dart\'s BLAKE2b-512 -- crypto-js has no BLAKE2b)', () => {
    it('is deterministic and produces a 128 hex-char (512-bit) digest', () => {
      const result = calculator.execute({ text: 'abc' })
      const digest = digestFor(result.digests, 'SHA3-512')
      expect(digest).toHaveLength(128)
      expect(digest).toMatch(/^[0-9a-f]+$/)

      const second = calculator.execute({ text: 'abc' })
      expect(digestFor(second.digests, 'SHA3-512')).toBe(digest)
    })

    it('differs for different inputs', () => {
      const a = calculator.execute({ text: 'abc' })
      const b = calculator.execute({ text: 'abd' })
      expect(digestFor(a.digests, 'SHA3-512')).not.toBe(digestFor(b.digests, 'SHA3-512'))
    })
  })

  describe('general behavior', () => {
    it('always returns exactly 5 plain digests in a stable order', () => {
      const result = calculator.execute({ text: 'hello' })
      expect(result.digests.map((d) => d.algorithmLabel)).toEqual([
        'MD5',
        'SHA-1',
        'SHA-256',
        'SHA-512',
        'SHA3-512',
      ])
    })

    it('omits HMAC digests when no secret key is given', () => {
      const result = calculator.execute({ text: 'hello' })
      expect(result.hmacDigests).toEqual([])
    })

    it('omits HMAC digests when the secret key is empty', () => {
      const result = calculator.execute({ text: 'hello', hmacSecretKey: '' })
      expect(result.hmacDigests).toEqual([])
    })

    it('produces 4 HMAC digests (MD5/SHA-1/SHA-256/SHA-512) when a secret key is given', () => {
      const result = calculator.execute({ text: 'hello', hmacSecretKey: 'secret' })
      expect(result.hmacDigests.map((d) => d.algorithmLabel)).toEqual([
        'HMAC-MD5',
        'HMAC-SHA-1',
        'HMAC-SHA-256',
        'HMAC-SHA-512',
      ])
    })

    it('different secret keys change the HMAC output', () => {
      const a = calculator.execute({ text: 'hello', hmacSecretKey: 'key-a' })
      const b = calculator.execute({ text: 'hello', hmacSecretKey: 'key-b' })
      expect(digestFor(a.hmacDigests, 'HMAC-SHA-256')).not.toBe(digestFor(b.hmacDigests, 'HMAC-SHA-256'))
    })
  })
})
