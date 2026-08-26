import { describe, expect, it } from 'vitest'
import {
  Base64FileDecoder,
  Base64FileEncoder,
  extensionForMimeType,
  guessMimeType,
} from './base64FileConverter'

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function bytesFromText(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function textFromBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

describe('Base64FileEncoder / Base64FileDecoder', () => {
  const encoder = new Base64FileEncoder()
  const decoder = new Base64FileDecoder()

  describe('bytes -> base64 -> bytes round trip', () => {
    it('genuinely binary bytes survive a round trip unchanged', () => {
      const bytes = Uint8Array.from([
        0, 1, 2, 255, 254, 128, 127, 16, 32, 64, 200, 201, 202, 3, 9, 250,
        ...Array.from({ length: 256 }, (_, i) => i),
      ])

      const encoded = encoder.execute({ bytes })
      const decoded = decoder.execute({ text: encoded.base64 })

      expect(decoded.bytes).toEqual(bytes)
      expect(decoded.byteSize).toBe(bytes.length)
    })

    it('all 256 byte values round trip exactly', () => {
      const bytes = Uint8Array.from(Array.from({ length: 256 }, (_, i) => i))

      const encoded = encoder.execute({ bytes })
      const decoded = decoder.execute({ text: encoded.base64 })

      expect(decoded.bytes).toEqual(bytes)
    })

    it('encodedLength reflects the bare base64 payload length', () => {
      const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7])
      const encoded = encoder.execute({ bytes })

      expect(encoded.encodedLength).toBe(encoded.base64.length)
      expect(encoded.byteSize).toBe(bytes.length)
    })

    it('plain wrapping with a line length wraps but still decodes back to the same bytes', () => {
      const bytes = Uint8Array.from(Array.from({ length: 200 }, (_, i) => (i * 53) % 256))

      const encoded = encoder.execute({ bytes, wrapping: 'plain', lineLength: 16 })

      expect(encoded.output.split('\n').length).toBeGreaterThan(1)
      expect(encoded.output.split('\n')[0]!.length).toBe(16)

      const decoded = decoder.execute({ text: encoded.output })
      expect(decoded.bytes).toEqual(bytes)
    })
  })

  describe('data URI form', () => {
    it('encodes as a data URI and decodes back to the original bytes with mime type recovered', () => {
      const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3])

      const encoded = encoder.execute({ bytes, wrapping: 'dataUri', mimeType: 'image/png' })

      expect(encoded.output.startsWith('data:image/png;base64,')).toBe(true)

      const decoded = decoder.execute({ text: encoded.output })
      expect(decoded.bytes).toEqual(bytes)
      expect(decoded.mimeType).toBe('image/png')
    })

    it('defaults to application/octet-stream when no mime type is given', () => {
      const bytes = Uint8Array.from([9, 9, 9])
      const encoded = encoder.execute({ bytes, wrapping: 'dataUri' })

      expect(encoded.output.startsWith('data:application/octet-stream;base64,')).toBe(true)
    })

    it('data URI with parameters (e.g. charset) still parses back correctly', () => {
      const payload = textToBase64('hi')
      const decoded = decoder.execute({
        text: `data:text/plain;charset=utf-8;base64,${payload}`,
      })
      expect(textFromBytes(decoded.bytes)).toBe('hi')
      expect(decoded.mimeType).toBe('text/plain')
    })

    it('a data: prefix without a base64 marker errors cleanly', () => {
      expect(() => decoder.execute({ text: 'data:text/plain,hello' })).toThrow()
    })
  })

  describe('kubernetes secret wrapping', () => {
    it('produces a single-line base64 value inside a v1/Secret manifest', () => {
      const bytes = bytesFromText('super secret value')
      const encoded = encoder.execute({
        bytes,
        wrapping: 'k8sSecret',
        secretName: 'my-secret',
        secretKey: 'file',
      })

      expect(encoded.output).toContain('kind: Secret')
      expect(encoded.output).toContain('name: my-secret')
      expect(encoded.output).toContain(`file: ${encoded.base64}`)
      // The data: value itself must stay single-line.
      const dataLine = encoded.output.split('\n').find((l) => l.trim().startsWith('file:'))!
      expect(dataLine.includes('\n')).toBe(false)
    })
  })

  describe('tolerant parsing', () => {
    it('base64 wrapped with newlines and no padding still decodes', () => {
      const original = 'wrap me please, this is a longer payload for wrapping'
      const encoded = textToBase64(original)
      const wrapped = []
      for (let i = 0; i < encoded.length; i += 8) {
        wrapped.push(encoded.slice(i, i + 8))
      }
      const wrappedText = wrapped.join('\n').replace(/=/g, '')

      const decoded = decoder.execute({ text: wrappedText })
      expect(textFromBytes(decoded.bytes)).toBe(original)
    })

    it('url-safe alphabet is accepted', () => {
      const bytes = Uint8Array.from([255, 239, 190, 0, 1])
      const encoded = encoder.execute({ bytes })
      const urlSafe = encoded.base64.replace(/\+/g, '-').replace(/\//g, '_')

      const decoded = decoder.execute({ text: urlSafe })
      expect(decoded.bytes).toEqual(bytes)
    })
  })

  describe('error handling', () => {
    it('encoding empty bytes is rejected', () => {
      expect(() => encoder.execute({ bytes: new Uint8Array(0) })).toThrow()
    })

    it('a line length below 4 is rejected', () => {
      expect(() =>
        encoder.execute({ bytes: Uint8Array.from([1, 2, 3]), lineLength: 2 }),
      ).toThrow()
    })

    it('decoding empty text is rejected', () => {
      expect(() => decoder.execute({ text: '   ' })).toThrow()
    })

    it('invalid base64 characters throw a clean error', () => {
      expect(() => decoder.execute({ text: '@@@not valid base64@@@' })).toThrow()
    })
  })

  describe('mime/extension helpers', () => {
    it('guesses mime types from common extensions', () => {
      expect(guessMimeType('photo.png')).toBe('image/png')
      expect(guessMimeType('archive.tar')).toBe('application/x-tar')
      expect(guessMimeType('unknownfile')).toBe('application/octet-stream')
      expect(guessMimeType('trailing.')).toBe('application/octet-stream')
    })

    it('resolves an extension back from a mime type', () => {
      expect(extensionForMimeType('image/png')).toBe('png')
      expect(extensionForMimeType('application/json')).toBe('json')
      expect(extensionForMimeType(null)).toBe('bin')
      expect(extensionForMimeType('application/x-made-up')).toBe('bin')
    })
  })
})
