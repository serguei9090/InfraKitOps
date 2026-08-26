import type { IToolUseCase } from '../ports/IToolUseCase'

/** Target raster format for {@link ImageConverter}. */
export type ImageOutputFormat = 'jpeg' | 'png' | 'webp'

export const IMAGE_OUTPUT_FORMATS: ImageOutputFormat[] = ['jpeg', 'png', 'webp']

interface FormatInfo {
  label: string
  extension: string
  mimeType: string
}

const FORMAT_INFO: Record<ImageOutputFormat, FormatInfo> = {
  jpeg: { label: 'JPEG', extension: 'jpg', mimeType: 'image/jpeg' },
  png: { label: 'PNG', extension: 'png', mimeType: 'image/png' },
  webp: { label: 'WebP', extension: 'webp', mimeType: 'image/webp' },
}

export function labelForFormat(format: ImageOutputFormat): string {
  return FORMAT_INFO[format].label
}

export function extensionForFormat(format: ImageOutputFormat): string {
  return FORMAT_INFO[format].extension
}

export function mimeTypeForFormat(format: ImageOutputFormat): string {
  return FORMAT_INFO[format].mimeType
}

export interface ImageConversionInput {
  /** Raw bytes of the source image, in any format the browser's image decoder can handle
   * (JPEG, PNG, GIF, BMP, WebP, ...). */
  sourceBytes: Uint8Array
  targetFormat: ImageOutputFormat
  /** 0-100. Mapped to Canvas's `toBlob` quality argument (0-1) for JPEG/WebP output.
   * Ignored for PNG — PNG is always lossless, and unlike `package:image`'s zlib
   * compression-*effort* level (0-9), the browser's Canvas `toBlob` has no PNG
   * compression-effort knob at all, so PNG output size is whatever the browser's
   * built-in PNG encoder produces regardless of this value. Defaults to 85. */
  quality?: number
  /** Optional resize bounds, applied before encoding. Aspect ratio is always preserved
   * (the output fits within the box, matching `package:image`'s
   * `copyResize(maintainAspect: true)`), so the output may be smaller than the exact
   * box requested. */
  maxWidth?: number
  maxHeight?: number
}

export interface ImageConversionResult {
  outputBytes: Uint8Array
  outputFormat: ImageOutputFormat

  sourceByteSize: number
  outputByteSize: number

  sourceWidth: number
  sourceHeight: number
  outputWidth: number
  outputHeight: number
}

/** outputByteSize / sourceByteSize. Less than 1.0 means the output is smaller than the
 * source; e.g. 0.4 means the output is 40% of the original size (a 60% reduction). */
export function compressionRatio(result: ImageConversionResult): number {
  return result.sourceByteSize === 0 ? 0 : result.outputByteSize / result.sourceByteSize
}

export function bytesSaved(result: ImageConversionResult): number {
  return result.sourceByteSize - result.outputByteSize
}

/** Positive when the output shrank, negative when it grew (can happen — e.g.
 * re-encoding a highly-optimized small PNG as JPEG at high quality). */
export function percentSaved(result: ImageConversionResult): number {
  return result.sourceByteSize === 0 ? 0 : (bytesSaved(result) / result.sourceByteSize) * 100
}

/** Throws if `quality` is outside the valid 0-100 range. */
export function validateQuality(quality: number): void {
  if (quality < 0 || quality > 100) {
    throw new Error(`quality must be between 0 and 100, got ${quality}`)
  }
}

/** Throws if either resize bound was supplied but isn't a positive number. */
export function validateResizeBounds(maxWidth?: number, maxHeight?: number): void {
  if ((maxWidth != null && maxWidth <= 0) || (maxHeight != null && maxHeight <= 0)) {
    throw new Error('maxWidth/maxHeight must be positive when given')
  }
}

/**
 * Computes the output dimensions for an aspect-ratio-preserving resize into an
 * optional `maxWidth`/`maxHeight` box — the same "fit within the box, keep aspect"
 * behavior as `package:image`'s `copyResize(maintainAspect: true)`. Pure and
 * synchronous so it's directly unit-testable, independent of the Canvas-dependent
 * encode step in {@link ImageConverter}.
 */
export function computeResizedDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth?: number,
  maxHeight?: number,
): { width: number; height: number } {
  if (maxWidth == null && maxHeight == null) {
    return { width: sourceWidth, height: sourceHeight }
  }
  let scale = Number.POSITIVE_INFINITY
  if (maxWidth != null) scale = Math.min(scale, maxWidth / sourceWidth)
  if (maxHeight != null) scale = Math.min(scale, maxHeight / sourceHeight)
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

/**
 * Image Format Converter & Compressor (spec 3.2): converts between JPEG, PNG and WebP
 * and optionally resizes/recompresses along the way, built on the browser's native
 * Canvas API — `createImageBitmap` to decode, `<canvas>` + `drawImage` to resize, and
 * `canvas.toBlob` to re-encode. Source format is auto-detected by the browser's
 * decoder; callers never need to say what the input is, only what they want out —
 * the same contract the Dart version's `package:image`-backed `ImageConverter` had.
 *
 * Unlike the Dart version (whose `package:image` 4.9.2 `WebPEncoder` only supports
 * lossless VP8L output, so `quality` was silently ignored for WebP targets), the
 * browser's `canvas.toBlob('image/webp', quality)` supports real lossy WebP encoding
 * — so here `quality` *does* apply to WebP output, not just JPEG. This is a genuine
 * capability improvement over the Dart core, not a regression.
 */
export class ImageConverter implements IToolUseCase<ImageConversionInput, ImageConversionResult> {
  async execute(input: ImageConversionInput): Promise<ImageConversionResult> {
    const quality = input.quality ?? 85
    validateQuality(quality)
    validateResizeBounds(input.maxWidth, input.maxHeight)

    let bitmap: ImageBitmap
    try {
      // `new Uint8Array(input.sourceBytes)` copies into a plain-`ArrayBuffer`-backed
      // view — `Blob`'s `BlobPart` type requires that concrete backing, which the
      // caller's `Uint8Array` isn't statically guaranteed to have.
      bitmap = await createImageBitmap(new Blob([new Uint8Array(input.sourceBytes)]))
    } catch {
      throw new Error('Could not decode image: unrecognized or corrupt image data')
    }

    const sourceWidth = bitmap.width
    const sourceHeight = bitmap.height
    const { width: outputWidth, height: outputHeight } = computeResizedDimensions(
      sourceWidth,
      sourceHeight,
      input.maxWidth,
      input.maxHeight,
    )

    const canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = outputHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      throw new Error('Canvas 2D context is not available in this environment')
    }
    ctx.drawImage(bitmap, 0, 0, outputWidth, outputHeight)
    bitmap.close()

    const mimeType = mimeTypeForFormat(input.targetFormat)
    // Quality only affects JPEG/WebP — passing it for PNG is harmless (ignored by
    // the encoder) but omitting it is clearer about intent.
    const encoderQuality = input.targetFormat === 'png' ? undefined : quality / 100

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('Image encoding failed'))),
        mimeType,
        encoderQuality,
      )
    })

    const outputBytes = new Uint8Array(await blob.arrayBuffer())

    return {
      outputBytes,
      outputFormat: input.targetFormat,
      sourceByteSize: input.sourceBytes.byteLength,
      outputByteSize: outputBytes.byteLength,
      sourceWidth,
      sourceHeight,
      outputWidth,
      outputHeight,
    }
  }
}
