import { describe, expect, it } from 'vitest'
import { GzipConverter, looksLikeGzip } from './gzipConverter'

function wrap(text: string, width: number): string {
  const lines: string[] = []
  for (let i = 0; i < text.length; i += width) {
    lines.push(text.slice(i, i + width))
  }
  return lines.join('\n')
}

describe('GzipConverter', () => {
  const converter = new GzipConverter()

  describe('compress / decompress round trip', () => {
    it('text survives a gzip round trip unchanged', () => {
      const original = 'InfraKit Studio — gzip round trip with ünïcode ✓\nline two\n'

      const compressed = converter.compressText(original)
      const restored = converter.decompressBytes(compressed.data)

      expect(restored.textOrNull).toBe(original)
      expect(restored.originalSize).toBe(new TextEncoder().encode(original).length)
    })

    it('arbitrary binary bytes survive a round trip unchanged', () => {
      const bytes = Uint8Array.from(Array.from({ length: 512 }, (_, i) => (i * 37) % 256))

      const compressed = converter.compressBytes(bytes)
      const restored = converter.decompressBytes(compressed.data)

      expect(restored.data).toEqual(bytes)
    })

    it('gzip output starts with the gzip magic number', () => {
      const compressed = converter.compressText('hello')
      expect(looksLikeGzip(compressed.data)).toBe(true)
      expect(compressed.data[0]).toBe(0x1f)
      expect(compressed.data[1]).toBe(0x8b)
    })
  })

  describe('size reporting', () => {
    it('a highly repetitive string compresses to a fraction of its size', () => {
      const repetitive = 'the same line over and over\n'.repeat(400)

      const result = converter.compressText(repetitive)

      expect(result.originalSize).toBe(new TextEncoder().encode(repetitive).length)
      expect(result.compressedSize).toBeLessThan(Math.floor(result.originalSize / 10))
      expect(result.compressionRatio).toBeLessThan(0.1)
      expect(result.spaceSavingPercent).toBeGreaterThan(90)
    })

    it('sizes are reported from the payload side regardless of direction', () => {
      const compressed = converter.compressText('a'.repeat(1000))
      const restored = converter.decompressBytes(compressed.data)

      expect(restored.originalSize).toBe(1000)
      expect(restored.compressedSize).toBe(compressed.compressedSize)
      expect(restored.compressionRatio).toBeCloseTo(compressed.compressionRatio, 9)
    })
  })

  describe('base64 transport', () => {
    it('text -> gzip -> base64 -> gzip -> text round trips', () => {
      const original = 'kubectl get pods -A | grep CrashLoopBackOff'

      const compressed = converter.compressText(original)
      const restored = converter.decompressBase64(compressed.base64)

      expect(restored.textOrNull).toBe(original)
    })

    it('base64 pasted with line breaks and no padding still decodes', () => {
      const text = 'wrapped payload '.repeat(20)
      const compressed = converter.compressText(text)

      const wrapped = wrap(compressed.base64, 40)
      const unpadded = wrapped.replace(/=/g, '')

      expect(converter.decompressBase64(wrapped).textOrNull).toBe(text)
      expect(converter.decompressBase64(unpadded).textOrNull).toBe(text)
    })

    it('url-safe base64 alphabet is accepted', () => {
      const compressed = converter.compressText('url safe alphabet test payload')
      const urlSafe = compressed.base64.replace(/\+/g, '-').replace(/\//g, '_')

      expect(converter.decompressBase64(urlSafe).textOrNull).toBe('url safe alphabet test payload')
    })
  })

  describe('error handling', () => {
    it('decompressing non-gzip bytes throws a clean error', () => {
      expect(() =>
        converter.decompressBytes(new TextEncoder().encode('this is just text')),
      ).toThrow(/Not a GZip stream/)
    })

    it('decompressing a truncated gzip stream throws a clean error', () => {
      const compressed = converter.compressText('truncate me '.repeat(100))
      const truncated = compressed.data.subarray(0, Math.floor(compressed.data.length / 2))

      expect(() => converter.decompressBytes(truncated)).toThrow(/GZip decompression failed/)
    })

    it('decompressing garbage base64 throws a clean error', () => {
      expect(() => converter.decompressBase64('not valid base64 @@@@')).toThrow()
    })

    it('empty input is rejected on both sides', () => {
      expect(() => converter.compressText('')).toThrow()
      expect(() => converter.compressBytes(new Uint8Array(0))).toThrow()
      expect(() => converter.decompressBytes(new Uint8Array(0))).toThrow()
      expect(() => converter.decompressBase64('   ')).toThrow()
    })

    it('an out-of-range compression level is rejected', () => {
      expect(() => converter.compressBytes(Uint8Array.from([1, 2, 3]), 12)).toThrow()
    })

    it('decompressed binary that is not UTF-8 yields null text instead of throwing', () => {
      const bytes = Uint8Array.from([0xff, 0xfe, 0x00, 0x80, 0xc0])
      const restored = converter.decompressBytes(converter.compressBytes(bytes).data)

      expect(restored.data).toEqual(bytes)
      expect(restored.textOrNull).toBeNull()
    })
  })

  describe('execute() port', () => {
    it('routes through the IToolUseCase entry point', () => {
      const source = new TextEncoder().encode('port test')

      const compressed = converter.execute({ data: source, operation: 'compress' })
      const restored = converter.execute({ data: compressed.data, operation: 'decompress' })

      expect(restored.data).toEqual(source)
    })
  })
})
