import { describe, expect, it } from 'vitest'
import { UuidUlidGenerator, WellKnownNamespace } from './uuidUlidGenerator'

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i

function expectUuidShape(value: string, expectedVersionNibble: number): void {
  expect(value).toMatch(uuidRegex)
  // Version nibble is the first character of the third group.
  expect(value.split('-')[2][0]).toBe(expectedVersionNibble.toString(16))
  // Variant nibble (first char of the fourth group) must be 8, 9, a, or b.
  const variantNibble = value.split('-')[3][0].toLowerCase()
  expect(['8', '9', 'a', 'b']).toContain(variantNibble)
}

describe('UuidUlidGenerator', () => {
  const generator = new UuidUlidGenerator()

  describe('UUID v1', () => {
    it('has correct shape and version nibble', () => {
      const result = generator.execute({ kind: 'uuidV1' })
      expectUuidShape(result.value, 1)
    })

    it('generates distinct values across calls', () => {
      const a = generator.execute({ kind: 'uuidV1' })
      const b = generator.execute({ kind: 'uuidV1' })
      expect(a.value).not.toBe(b.value)
    })
  })

  describe('UUID v4', () => {
    it('has correct shape and version nibble', () => {
      const result = generator.execute({ kind: 'uuidV4' })
      expectUuidShape(result.value, 4)
    })

    it('generates distinct values across calls', () => {
      const a = generator.execute({ kind: 'uuidV4' })
      const b = generator.execute({ kind: 'uuidV4' })
      expect(a.value).not.toBe(b.value)
    })
  })

  describe('UUID v3', () => {
    it('has correct shape and version nibble', () => {
      const result = generator.execute({
        kind: 'uuidV3',
        namespace: WellKnownNamespace.dns,
        name: 'example.com',
      })
      expectUuidShape(result.value, 3)
    })

    it('is deterministic for the same namespace and name', () => {
      const input = { kind: 'uuidV3' as const, namespace: WellKnownNamespace.dns, name: 'example.com' }
      const a = generator.execute(input)
      const b = generator.execute(input)
      expect(a.value).toBe(b.value)
    })

    it('differs for a different name', () => {
      const a = generator.execute({ kind: 'uuidV3', namespace: WellKnownNamespace.dns, name: 'example.com' })
      const b = generator.execute({ kind: 'uuidV3', namespace: WellKnownNamespace.dns, name: 'other.com' })
      expect(a.value).not.toBe(b.value)
    })

    it('throws when namespace or name is missing', () => {
      expect(() => generator.execute({ kind: 'uuidV3', name: 'example.com' })).toThrow()
      expect(() => generator.execute({ kind: 'uuidV3', namespace: WellKnownNamespace.dns })).toThrow()
    })

    it('matches the canonical RFC 4122 test vector (Python\'s uuid.uuid3(NAMESPACE_DNS, "python.org"))', () => {
      const result = generator.execute({ kind: 'uuidV3', namespace: WellKnownNamespace.dns, name: 'python.org' })
      expect(result.value).toBe('6fa459ea-ee8a-3ca4-894e-db77e160355e')
    })
  })

  describe('UUID v5', () => {
    it('has correct shape and version nibble', () => {
      const result = generator.execute({
        kind: 'uuidV5',
        namespace: WellKnownNamespace.url,
        name: 'https://example.com',
      })
      expectUuidShape(result.value, 5)
    })

    it('is deterministic for the same namespace and name', () => {
      const input = { kind: 'uuidV5' as const, namespace: WellKnownNamespace.url, name: 'https://example.com' }
      const a = generator.execute(input)
      const b = generator.execute(input)
      expect(a.value).toBe(b.value)
    })

    it('throws when namespace or name is missing', () => {
      expect(() => generator.execute({ kind: 'uuidV5' })).toThrow()
    })

    it('matches the canonical RFC 4122 test vector (Python\'s uuid.uuid5(NAMESPACE_DNS, "python.org"))', () => {
      const result = generator.execute({ kind: 'uuidV5', namespace: WellKnownNamespace.dns, name: 'python.org' })
      expect(result.value).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d')
    })
  })

  it('v3 and v5 differ for the same namespace and name', () => {
    const v3 = generator.execute({ kind: 'uuidV3', namespace: WellKnownNamespace.dns, name: 'example.com' })
    const v5 = generator.execute({ kind: 'uuidV5', namespace: WellKnownNamespace.dns, name: 'example.com' })
    expect(v3.value).not.toBe(v5.value)
  })

  describe('ULID', () => {
    it('has the correct 26-character Crockford base32 shape', () => {
      const result = generator.execute({ kind: 'ulid' })
      expect(result.value).toMatch(ulidRegex)
    })

    it('generates distinct values across calls', () => {
      const a = generator.execute({ kind: 'ulid' })
      const b = generator.execute({ kind: 'ulid' })
      expect(a.value).not.toBe(b.value)
    })
  })
})
