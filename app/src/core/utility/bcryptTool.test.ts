import { describe, expect, it } from 'vitest'
import { BcryptHasher, BcryptVerifier } from './bcryptTool'

describe('BcryptHasher', () => {
  const hasher = new BcryptHasher()
  const verifier = new BcryptVerifier()

  it('produces a well-formed bcrypt hash string', () => {
    const result = hasher.execute({ plaintext: 'hunter2', logRounds: 4 })
    // $<version>$<cost>$<22-char salt><31-char digest>
    expect(result.hash).toMatch(/^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/)
    // bcryptjs emits the $2b$ minor-version marker, not Dart bcrypt's $2a$ --
    // both verify identically, see the class doc in bcryptTool.ts.
    expect(result.hash.startsWith('$2b$04$')).toBe(true)
  })

  it('generates a different hash each time for the same plaintext (random salt)', () => {
    const a = hasher.execute({ plaintext: 'hunter2', logRounds: 4 })
    const b = hasher.execute({ plaintext: 'hunter2', logRounds: 4 })
    expect(a.hash).not.toBe(b.hash)
  })

  it('rejects out-of-range log-rounds', () => {
    expect(() => hasher.execute({ plaintext: 'hunter2', logRounds: 1 })).toThrow()
    expect(() => hasher.execute({ plaintext: 'hunter2', logRounds: 99 })).toThrow()
  })

  describe('BcryptVerifier', () => {
    it('accepts the correct plaintext against a freshly generated hash', () => {
      const hash = hasher.execute({ plaintext: 'correct horse battery staple', logRounds: 4 })
      const result = verifier.execute({ plaintext: 'correct horse battery staple', hash: hash.hash })
      expect(result.matches).toBe(true)
    })

    it('rejects the wrong plaintext against a valid hash', () => {
      const hash = hasher.execute({ plaintext: 'correct horse battery staple', logRounds: 4 })
      const result = verifier.execute({ plaintext: 'wrong password', hash: hash.hash })
      expect(result.matches).toBe(false)
    })

    it('verifies against a pre-recorded fixture hash (fixed-salt regression vector)', () => {
      // bcrypt embeds a random salt in every hash, so there is no
      // cross-implementation "hash of 'abc'" constant the way there is for
      // MD5/SHA-256. This fixture was generated once with Dart's `bcrypt`
      // package (hence the $2a$ marker) and is frozen here so the
      // verifier's decoding of an externally-produced hash string is
      // exercised, not just a live hash-then-immediately-verify round trip.
      // bcryptjs verifies $2a$/$2b$/$2y$ hashes interchangeably.
      const fixtureHash = '$2a$04$y4tiGeWwdpFlQhdt/zqxf.ZbJzRxB2WjyEZXYjWxuSEEsplrY8JQ2'

      const correct = verifier.execute({ plaintext: 'correct horse battery staple', hash: fixtureHash })
      expect(correct.matches).toBe(true)

      const wrong = verifier.execute({ plaintext: 'wrong password', hash: fixtureHash })
      expect(wrong.matches).toBe(false)
    })

    it('returns false (not a thrown error) for a malformed hash string', () => {
      const result = verifier.execute({ plaintext: 'hunter2', hash: 'not-a-bcrypt-hash' })
      expect(result.matches).toBe(false)
    })
  })
})
