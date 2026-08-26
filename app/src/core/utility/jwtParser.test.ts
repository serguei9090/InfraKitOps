import { describe, expect, it } from 'vitest'
import { decodeBase64Url, formatJwtDuration, JWT_SIGNATURE_NOTICE, JwtParser, type JwtParseResult } from './jwtParser'

/** `{"alg":"HS256","typ":"JWT"}` */
const headerHs256 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

/** `{"alg":"none","typ":"JWT"}` — 35 chars, so base64url padding is missing. */
const headerNone = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0'

/**
 * The canonical jwt.io demo payload:
 * `{"sub":"1234567890","name":"John Doe","iat":1516239022}`
 */
const payloadClassic = 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ'

/** All seven registered claims; `exp` = 1600000000 (2020-09-13T12:26:40Z). */
const payloadAllClaims =
  'eyJpc3MiOiJodHRwczovL2F1dGguaW5mcmFraXQudGVzdC8iLCJzdWIiOiJ1c2VyLTQyIiwiYXVkIjoiaW5mcmFraXQt' +
  'YXBpIiwiZXhwIjoxNjAwMDAwMDAwLCJuYmYiOjE1MDAwMDAwMDAsImlhdCI6MTUwMDAwMDAwMCwianRpIjoiYWJjLTEyMyJ9'

/** `exp` = 4102444800 (2100-01-01T00:00:00Z). */
const payloadFarFuture =
  'eyJpc3MiOiJodHRwczovL2F1dGguaW5mcmFraXQudGVzdC8iLCJzdWIiOiJ1c2VyLTQyIiwiZXhwIjo0MTAyNDQ0ODAwLCJpYXQiOjE1MDAwMDAwMDB9'

/** `{"sub":"early","nbf":4102444800,"exp":4102531200}` */
const payloadNotYetValid = 'eyJzdWIiOiJlYXJseSIsIm5iZiI6NDEwMjQ0NDgwMCwiZXhwIjo0MTAyNTMxMjAwfQ'

/** `[1,2,3]` — valid base64url, valid JSON, but not a JSON *object*. */
const payloadJsonArray = 'WzEsMiwzXQ'

const signature = 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

/** A fixed "now" so expiry assertions never depend on the wall clock. */
const now = new Date(Date.UTC(2024, 5, 1, 12))

function parse(token: string): JwtParseResult {
  return new JwtParser().execute({ token, now })
}

describe('JwtParser', () => {
  describe('decoding a known token', () => {
    const result = parse(`${headerHs256}.${payloadClassic}.${signature}`)

    it('reports a structurally valid token', () => {
      expect(result.isValidStructure).toBe(true)
      expect(result.errorMessage).toBeUndefined()
      expect(result.segmentCount).toBe(3)
    })

    it('decodes the header to the expected map', () => {
      expect(result.header).toEqual({ alg: 'HS256', typ: 'JWT' })
      expect(result.algorithm).toBe('HS256')
      expect(result.tokenType).toBe('JWT')
      expect(result.keyId).toBeUndefined()
    })

    it('decodes the payload to the expected map', () => {
      expect(result.payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 })
    })

    it('pretty-prints both segments as indented JSON', () => {
      expect(result.headerJson).toContain('"alg": "HS256"')
      expect(result.payloadJson).toContain('"sub": "1234567890"')
      expect(result.payloadJson).toContain('\n')
    })

    it('keeps the signature segment intact but does not verify it', () => {
      expect(result.signatureBase64Url).toBe(signature)
    })

    it('converts iat to a real Date', () => {
      expect(result.issuedAt).toEqual(new Date(Date.UTC(2018, 0, 18, 1, 30, 22)))
    })

    it('tolerates a Bearer prefix and wrapped whitespace', () => {
      const prefixed = parse(`  Bearer ${headerHs256}.\n${payloadClassic}.\n${signature}  `)
      expect(prefixed.isValidStructure).toBe(true)
      expect(prefixed.payload['sub']).toBe('1234567890')
    })
  })

  describe('base64url without padding', () => {
    it('decodes a 35-character segment that needs one "=" restored', () => {
      // headerNone.length % 4 == 3, so the raw string is not valid base64.
      expect(headerNone.length % 4).toBe(3)
      const result = parse(`${headerNone}.${payloadClassic}.`)
      expect(result.isValidStructure).toBe(true)
      expect(result.header['alg']).toBe('none')
    })

    it('decodeBase64Url restores padding directly', () => {
      // "eyJhIjoxfQ" is `{"a":1}` with the padding stripped.
      const bytes = decodeBase64Url('eyJhIjoxfQ')
      expect(new TextDecoder().decode(bytes)).toBe('{"a":1}')
    })

    it('decodes base64url -/_ characters, not just +/', () => {
      const decoded = decodeBase64Url('-_-_')
      expect(Array.from(decoded)).toEqual([251, 255, 191])
    })
  })

  describe('registered claims', () => {
    const result = parse(`${headerHs256}.${payloadAllClaims}.${signature}`)

    it('surfaces all seven in canonical order', () => {
      expect(result.registeredClaims.map((c) => c.name)).toEqual(['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti'])
    })

    it('each carries a human-readable label and meaning', () => {
      for (const claim of result.registeredClaims) {
        expect(claim.label.length).toBeGreaterThan(0)
        expect(claim.meaning.length).toBeGreaterThan(0)
      }
      const exp = result.registeredClaims.find((c) => c.name === 'exp')!
      expect(exp.label).toBe('Expires at')
      expect(exp.meaning).toContain('accept')
    })

    it('NumericDate claims become Dates and display as ISO-8601 UTC', () => {
      const exp = result.registeredClaims.find((c) => c.name === 'exp')!
      expect(exp.dateTime).toEqual(new Date(Date.UTC(2020, 8, 13, 12, 26, 40)))
      expect(exp.displayValue).toBe('2020-09-13T12:26:40Z UTC')
      expect(exp.rawValue).toBe(1600000000)
    })

    it('non-date claims keep their raw string value', () => {
      const iss = result.registeredClaims.find((c) => c.name === 'iss')!
      expect(iss.dateTime).toBeUndefined()
      expect(iss.displayValue).toBe('https://auth.infrakit.test/')
    })

    it('claims that are absent are not invented', () => {
      const classic = parse(`${headerHs256}.${payloadClassic}.${signature}`)
      expect(classic.registeredClaims.map((c) => c.name)).toEqual(['sub', 'iat'])
    })
  })

  describe('expiry detection', () => {
    it('an exp in the past is reported as expired with a negative remainder', () => {
      const result = parse(`${headerHs256}.${payloadAllClaims}.${signature}`)
      expect(result.temporalStatus).toBe('expired')
      expect(result.expiresAt).toEqual(new Date(Date.UTC(2020, 8, 13, 12, 26, 40)))
      expect(result.timeUntilExpiryMs!).toBeLessThan(0)
    })

    it('an exp in the future is still valid with a positive remainder', () => {
      const result = parse(`${headerHs256}.${payloadFarFuture}.${signature}`)
      expect(result.temporalStatus).toBe('valid')
      expect(result.expiresAt).toEqual(new Date(Date.UTC(2100, 0, 1)))
      expect(result.timeUntilExpiryMs!).toBeGreaterThanOrEqual(0)
      expect(result.timeUntilExpiryMs! / 86400000).toBeGreaterThan(27000)
    })

    it('an nbf in the future is reported as not-yet-valid', () => {
      const result = parse(`${headerHs256}.${payloadNotYetValid}.${signature}`)
      expect(result.temporalStatus).toBe('notYetValid')
      expect(result.timeUntilValidMs).not.toBeUndefined()
      expect(result.timeUntilValidMs!).toBeGreaterThanOrEqual(0)
    })

    it('a token with no time claims at all is not called expired', () => {
      const result = parse(`${headerHs256}.${payloadClassic}.${signature}`)
      expect(result.temporalStatus).toBe('valid')
      expect(result.expiresAt).toBeUndefined()
      expect(result.timeUntilExpiryMs).toBeUndefined()
    })

    it('exp exactly at "now" counts as expired', () => {
      const at = new Date(Date.UTC(2020, 8, 13, 12, 26, 40))
      const result = new JwtParser().execute({ token: `${headerHs256}.${payloadAllClaims}.${signature}`, now: at })
      expect(result.temporalStatus).toBe('expired')
    })

    it('formatJwtDuration renders a readable countdown', () => {
      expect(formatJwtDuration(45 * 1000)).toBe('45s')
      expect(formatJwtDuration(90 * 60 * 1000)).toBe('1h 30m')
      expect(formatJwtDuration((2 * 24 + 3) * 3600 * 1000)).toBe('2d 3h')
      expect(formatJwtDuration(-2 * 24 * 3600 * 1000)).toBe('2d')
    })
  })

  describe('alg: none is flagged', () => {
    it('an unsecured JWT with an empty signature is flagged', () => {
      const result = parse(`${headerNone}.${payloadClassic}.`)
      expect(result.isValidStructure).toBe(true)
      expect(result.algorithm).toBe('none')
      expect(result.isUnsignedAlgorithm).toBe(true)
    })

    it('alg "NONE" in any casing is flagged', () => {
      // {"alg":"None"} base64url-encoded.
      const mixedCase = 'eyJhbGciOiJOb25lIn0'
      const result = parse(`${mixedCase}.${payloadClassic}.`)
      expect(result.isUnsignedAlgorithm).toBe(true)
    })

    it('a missing third segment counts as unsigned', () => {
      const result = parse(`${headerHs256}.${payloadClassic}`)
      expect(result.isValidStructure).toBe(true)
      expect(result.segmentCount).toBe(2)
      expect(result.isUnsignedAlgorithm).toBe(true)
    })

    it('a normal HS256 token is not flagged', () => {
      const result = parse(`${headerHs256}.${payloadClassic}.${signature}`)
      expect(result.isUnsignedAlgorithm).toBe(false)
    })
  })

  describe('signature is never verified', () => {
    it('the notice says so plainly', () => {
      expect(JWT_SIGNATURE_NOTICE).toContain('NOT verified')
      expect(JWT_SIGNATURE_NOTICE).toContain('only decodes')
      expect(JWT_SIGNATURE_NOTICE.toLowerCase()).toContain('forged')
    })
  })

  describe('malformed input errors cleanly, never throws', () => {
    function expectsFailure(token: string, containing?: string) {
      const result = parse(token)
      expect(result.isValidStructure).toBe(false)
      expect(result.errorMessage).not.toBeUndefined()
      expect(result.errorMessage!.length).toBeGreaterThan(0)
      if (containing !== undefined) expect(result.errorMessage).toContain(containing)
    }

    it('empty input', () => expectsFailure('', 'Enter a JWT'))
    it('whitespace only', () => expectsFailure('   \n  '))

    it('one segment', () => expectsFailure('notajwt', '3 dot-separated'))

    it('four segments', () => {
      expectsFailure(`${headerHs256}.${payloadClassic}.${signature}.extra`, '3 dot-separated')
    })

    it('empty header segment', () => expectsFailure(`.${payloadClassic}.${signature}`))

    it('bad base64 in the header', () => {
      expectsFailure(`!!!not-base64!!!.${payloadClassic}.${signature}`, 'base64url')
    })

    it('bad base64 in the payload', () => {
      expectsFailure(`${headerHs256}.!!!nope!!!.${signature}`, 'base64url')
    })

    it('valid base64 that is not JSON', () => {
      // "aGVsbG8gd29ybGQ" is "hello world".
      expectsFailure(`aGVsbG8gd29ybGQ.${payloadClassic}.${signature}`, 'not valid JSON')
    })

    it('JSON that is not an object', () => {
      expectsFailure(`${headerHs256}.${payloadJsonArray}.${signature}`, 'must be a JSON object')
    })

    it('failures carry no half-populated decoded data', () => {
      const result = parse('nope')
      expect(result.header).toEqual({})
      expect(result.payload).toEqual({})
      expect(result.registeredClaims).toEqual([])
      expect(result.headerJson).toBe('')
    })
  })
})
