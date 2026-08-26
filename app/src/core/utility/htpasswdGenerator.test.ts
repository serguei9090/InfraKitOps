import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'
import {
  apr1Verify,
  apr1Crypt,
  BasicAuthHeaderBuilder,
  basicAuthHeaderLine,
  basicAuthHeaderValue,
  HTPASSWD_ALGORITHM_INFO,
  HtpasswdGenerator,
  validateHtpasswdUsername,
} from './htpasswdGenerator'

describe('HtpasswdGenerator', () => {
  const generator = new HtpasswdGenerator()

  describe('bcrypt', () => {
    it('produces a "user:$2..." line whose hash verifies against bcrypt\'s own checker', () => {
      const result = generator.execute({
        entries: [{ username: 'alice', password: 'correct horse battery staple' }],
      })

      expect(result.lines).toHaveLength(1)
      const line = result.lines[0]
      expect(line.username).toBe('alice')
      expect(`${line.username}:${line.hash}`.startsWith('alice:$2')).toBe(true)
      // Don't just pattern-match the string shape — ask bcrypt itself whether
      // the hash actually verifies the password it was generated from.
      expect(bcrypt.compareSync('correct horse battery staple', line.hash)).toBe(true)
      expect(bcrypt.compareSync('wrong password', line.hash)).toBe(false)
    })

    it('honours a custom bcrypt cost and encodes it in the hash', () => {
      const result = generator.execute({
        entries: [{ username: 'bob', password: 'hunter2' }],
        bcryptCost: 6,
      })
      const hash = result.lines[0].hash
      // bcryptjs emits the $2b$ minor-version marker, not Dart bcrypt's $2a$.
      expect(hash.startsWith('$2b$06$')).toBe(true)
      expect(bcrypt.compareSync('hunter2', hash)).toBe(true)
    })

    it('warns (but still generates) when the bcrypt cost is low', () => {
      const result = generator.execute({
        entries: [{ username: 'bob', password: 'x' }],
        bcryptCost: 4,
      })
      expect(result.warnings.join('')).toContain('bcrypt cost 4 is low')
    })

    it("rejects a bcrypt cost outside the algorithm's legal 4..31 range", () => {
      expect(() =>
        generator.execute({ entries: [{ username: 'bob', password: 'x' }], bcryptCost: 3 }),
      ).toThrow()
      expect(() =>
        generator.execute({ entries: [{ username: 'bob', password: 'x' }], bcryptCost: 32 }),
      ).toThrow()
    })

    it('a password at exactly the 72-byte limit hashes cleanly with no warning', () => {
      const result = generator.execute({
        entries: [{ username: 'bob', password: 'x'.repeat(72) }],
      })
      expect(result.warnings).toEqual([])
      expect(bcrypt.compareSync('x'.repeat(72), result.lines[0].hash)).toBe(true)
    })

    it('a password over the 72-byte limit is rejected rather than silently truncated', () => {
      // bcryptjs (unlike Dart's `bcrypt` package, whose own hashpw() throws)
      // silently truncates passwords beyond the 72-byte bcrypt limit, so the
      // TS port enforces the limit itself in hashPassword() -- see the class
      // doc in htpasswdGenerator.ts. Same observable behavior (a throw),
      // different layer doing the throwing.
      expect(() =>
        generator.execute({ entries: [{ username: 'bob', password: 'x'.repeat(73) }] }),
      ).toThrow()
    })
  })

  describe('Basic-auth header', () => {
    it('round-trips through base64 back to "user:password"', () => {
      const builder = new BasicAuthHeaderBuilder()
      const result = builder.execute({ username: 'alice', password: 'correct horse battery staple' })

      const decoded = atob(result.credentialsBase64)
      expect(decoded).toBe('alice:correct horse battery staple')
      expect(basicAuthHeaderValue(result)).toBe(`Basic ${result.credentialsBase64}`)
      expect(basicAuthHeaderLine(result)).toBe(`Authorization: Basic ${result.credentialsBase64}`)
    })

    it('rejects a username containing ":" (ambiguous with the credential separator)', () => {
      const builder = new BasicAuthHeaderBuilder()
      expect(() => builder.execute({ username: 'al:ice', password: 'x' })).toThrow()
    })

    it('rejects multi-line credentials', () => {
      const builder = new BasicAuthHeaderBuilder()
      expect(() => builder.execute({ username: 'alice\nbob', password: 'x' })).toThrow()
      expect(() => builder.execute({ username: 'alice', password: 'x\ny' })).toThrow()
    })
  })

  describe('multi-user file', () => {
    it('emits exactly one line per user, in input order', () => {
      const result = generator.execute({
        entries: [
          { username: 'alice', password: 'pw1' },
          { username: 'bob', password: 'pw2' },
          { username: 'carol', password: 'pw3' },
        ],
      })

      expect(result.lines).toHaveLength(3)
      expect(result.lines.map((l) => l.username)).toEqual(['alice', 'bob', 'carol'])

      const fileLines = result.fileContent.trim().split('\n')
      expect(fileLines).toHaveLength(3)
      expect(fileLines[0].startsWith('alice:')).toBe(true)
      expect(fileLines[1].startsWith('bob:')).toBe(true)
      expect(fileLines[2].startsWith('carol:')).toBe(true)
    })

    it('warns on a duplicate username but still emits both lines', () => {
      const result = generator.execute({
        entries: [
          { username: 'alice', password: 'pw1' },
          { username: 'alice', password: 'pw2' },
        ],
      })
      expect(result.lines).toHaveLength(2)
      expect(result.warnings.join('')).toContain('Duplicate user "alice"')
    })

    it('an optional header comment is prepended when requested', () => {
      const result = generator.execute({
        entries: [{ username: 'alice', password: 'pw1' }],
        includeHeaderComment: true,
      })
      expect(result.fileContent.startsWith('# .htpasswd')).toBe(true)
    })

    it('rejects an empty entry list', () => {
      expect(() => generator.execute({ entries: [] })).toThrow()
    })
  })

  describe('username validation', () => {
    it('rejects a username containing ":"', () => {
      expect(validateHtpasswdUsername('al:ice')).not.toBeNull()
      expect(() =>
        generator.execute({ entries: [{ username: 'al:ice', password: 'x' }] }),
      ).toThrow()
    })

    it('rejects an empty username', () => {
      expect(validateHtpasswdUsername('')).not.toBeNull()
    })

    it('rejects leading/trailing whitespace and control characters', () => {
      expect(validateHtpasswdUsername(' alice')).not.toBeNull()
      expect(validateHtpasswdUsername('alice ')).not.toBeNull()
      expect(validateHtpasswdUsername('alice\n')).not.toBeNull()
      expect(validateHtpasswdUsername(String.fromCharCode(97, 108, 105, 1, 99, 101))).not.toBeNull()
    })

    it('accepts an ordinary username', () => {
      expect(validateHtpasswdUsername('alice')).toBeNull()
      expect(validateHtpasswdUsername('alice.smith-01')).toBeNull()
    })
  })

  describe('other algorithms present in the core (not dropped)', () => {
    // APR1 and legacy SHA-1 are both still implemented in
    // htpasswdGenerator.ts, so they get basic coverage here too, alongside
    // the required bcrypt/Basic-auth/multi-user/username cases above.

    it('APR1 hash carries the $apr1$ prefix and round-trips through apr1Verify', () => {
      const result = generator.execute({
        entries: [{ username: 'alice', password: 'hunter2' }],
        algorithm: 'apr1',
      })
      const hash = result.lines[0].hash
      expect(hash.startsWith('$apr1$')).toBe(true)
      expect(apr1Verify('hunter2', hash)).toBe(true)
      expect(apr1Verify('wrong', hash)).toBe(false)
      expect(result.warnings.join('')).toContain('APR1')
    })

    it('apr1Crypt with a fixed salt is deterministic', () => {
      const a = apr1Crypt('hunter2', 'abcdefgh')
      const b = apr1Crypt('hunter2', 'abcdefgh')
      expect(a).toBe(b)
      expect(a.startsWith('$apr1$abcdefgh$')).toBe(true)
    })

    it('SHA-1 ({SHA}) hash matches base64(sha1(password)) and is flagged legacy', () => {
      const result = generator.execute({
        entries: [{ username: 'alice', password: 'hunter2' }],
        algorithm: 'sha1',
      })
      const hash = result.lines[0].hash
      expect(hash.startsWith('{SHA}')).toBe(true)
      expect(HTPASSWD_ALGORITHM_INFO.sha1.isLegacy).toBe(true)
      expect(result.warnings.join('')).toContain('unsalted')
    })
  })
})
