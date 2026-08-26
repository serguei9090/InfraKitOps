import { describe, expect, it } from 'vitest'
import {
  bytesSaved,
  compressionRatio,
  computeResizedDimensions,
  extensionForFormat,
  IMAGE_OUTPUT_FORMATS,
  labelForFormat,
  mimeTypeForFormat,
  percentSaved,
  validateQuality,
  validateResizeBounds,
  type ImageConversionResult,
} from './imageConverter'

// NOTE: `ImageConverter.execute()` itself (createImageBitmap/<canvas>/toBlob) is not
// unit-tested here. Vitest's default `environment: 'node'` has no `document`,
// `Image`, `createImageBitmap` or `<canvas>` — exercising the real encode/decode
// path would require a jsdom + canvas polyfill dependency, which is out of scope per
// the task brief. Everything byte-math/validation-shaped that the async Canvas path
// delegates to is pure and covered below instead.

describe('format info helpers', () => {
  it('covers all three output formats', () => {
    expect(IMAGE_OUTPUT_FORMATS).toEqual(['jpeg', 'png', 'webp'])
  })

  it('returns the expected label/extension/mimeType per format', () => {
    expect(labelForFormat('jpeg')).toBe('JPEG')
    expect(extensionForFormat('jpeg')).toBe('jpg')
    expect(mimeTypeForFormat('jpeg')).toBe('image/jpeg')

    expect(labelForFormat('png')).toBe('PNG')
    expect(extensionForFormat('png')).toBe('png')
    expect(mimeTypeForFormat('png')).toBe('image/png')

    expect(labelForFormat('webp')).toBe('WebP')
    expect(extensionForFormat('webp')).toBe('webp')
    expect(mimeTypeForFormat('webp')).toBe('image/webp')
  })
})

describe('validateQuality', () => {
  it('accepts the full 0-100 range', () => {
    expect(() => validateQuality(0)).not.toThrow()
    expect(() => validateQuality(100)).not.toThrow()
    expect(() => validateQuality(85)).not.toThrow()
  })

  it('rejects out-of-range values', () => {
    expect(() => validateQuality(-1)).toThrow()
    expect(() => validateQuality(101)).toThrow()
  })
})

describe('validateResizeBounds', () => {
  it('accepts undefined, and positive values', () => {
    expect(() => validateResizeBounds()).not.toThrow()
    expect(() => validateResizeBounds(100, 200)).not.toThrow()
    expect(() => validateResizeBounds(100)).not.toThrow()
    expect(() => validateResizeBounds(undefined, 200)).not.toThrow()
  })

  it('rejects zero or negative bounds', () => {
    expect(() => validateResizeBounds(0)).toThrow()
    expect(() => validateResizeBounds(-5)).toThrow()
    expect(() => validateResizeBounds(100, 0)).toThrow()
    expect(() => validateResizeBounds(100, -5)).toThrow()
  })
})

describe('computeResizedDimensions', () => {
  it('returns the source size unchanged when no bounds are given', () => {
    expect(computeResizedDimensions(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('scales down to fit maxWidth, preserving aspect ratio', () => {
    // 800x600, 4:3 -> max width 400 => 400x300
    expect(computeResizedDimensions(800, 600, 400)).toEqual({ width: 400, height: 300 })
  })

  it('scales down to fit maxHeight, preserving aspect ratio', () => {
    expect(computeResizedDimensions(800, 600, undefined, 150)).toEqual({ width: 200, height: 150 })
  })

  it('picks the smaller scale when both bounds are given (fit within the box)', () => {
    // 800x600 into a 1000x150 box: height is the binding constraint.
    expect(computeResizedDimensions(800, 600, 1000, 150)).toEqual({ width: 200, height: 150 })
    // 800x600 into a 100x1000 box: width is the binding constraint.
    expect(computeResizedDimensions(800, 600, 100, 1000)).toEqual({ width: 100, height: 75 })
  })

  it('never scales up past the requested box even for a tiny source', () => {
    const result = computeResizedDimensions(10, 10, 1000, 1000)
    expect(result.width).toBeGreaterThan(10)
    expect(result.height).toBeGreaterThan(10)
    // Aspect ratio (1:1) is still preserved even when scaling up.
    expect(result.width).toBe(result.height)
  })

  it('always produces at least a 1x1 output', () => {
    expect(computeResizedDimensions(1000, 1000, 1)).toEqual({ width: 1, height: 1 })
  })
})

describe('compressionRatio / bytesSaved / percentSaved', () => {
  function result(sourceByteSize: number, outputByteSize: number): ImageConversionResult {
    return {
      outputBytes: new Uint8Array(outputByteSize),
      outputFormat: 'jpeg',
      sourceByteSize,
      outputByteSize,
      sourceWidth: 100,
      sourceHeight: 100,
      outputWidth: 100,
      outputHeight: 100,
    }
  }

  it('computes a sub-1.0 ratio and positive savings when output shrank', () => {
    const r = result(1000, 400)
    expect(compressionRatio(r)).toBeCloseTo(0.4, 5)
    expect(bytesSaved(r)).toBe(600)
    expect(percentSaved(r)).toBeCloseTo(60, 5)
  })

  it('computes negative savings when output grew', () => {
    const r = result(400, 1000)
    expect(compressionRatio(r)).toBeCloseTo(2.5, 5)
    expect(bytesSaved(r)).toBe(-600)
    expect(percentSaved(r)).toBeCloseTo(-150, 5)
  })

  it('handles a zero-size source without dividing by zero', () => {
    const r = result(0, 0)
    expect(compressionRatio(r)).toBe(0)
    expect(bytesSaved(r)).toBe(0)
    expect(percentSaved(r)).toBe(0)
  })
})
