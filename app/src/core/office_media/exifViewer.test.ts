import { describe, expect, it } from 'vitest'
import {
  dmsToDecimalDegrees,
  formatExposureTime,
  isEmptyMetadata,
  orientationLabel,
  type ExifMetadata,
} from './exifViewer'

// NOTE: `ExifViewer.execute()` itself (which calls into `exifr.parse()`) is not
// unit-tested here. Real EXIF parsing needs an actual binary JPEG with an EXIF
// segment, which is awkward to fabricate by hand for a lightweight unit test (and
// exifr's own test suite already covers its parsing correctness). Instead these
// tests cover the pure normalization/formatting logic this module adds on top —
// GPS DMS-to-decimal conversion, exposure-time formatting, orientation labels, and
// the empty-metadata check — none of which touch exifr or the network/filesystem.

describe('isEmptyMetadata', () => {
  it('is true for a metadata object with no fields set', () => {
    expect(isEmptyMetadata({})).toBe(true)
  })

  it('is false as soon as any single field is set', () => {
    const base: ExifMetadata = {}
    expect(isEmptyMetadata({ ...base, cameraMake: 'Canon' })).toBe(false)
    expect(isEmptyMetadata({ ...base, isoSpeed: 100 })).toBe(false)
    expect(isEmptyMetadata({ ...base, gps: { latitude: 1, longitude: 2 } })).toBe(false)
  })
})

describe('orientationLabel', () => {
  it('returns undefined when orientation is undefined', () => {
    expect(orientationLabel(undefined)).toBeUndefined()
  })

  it('maps known orientation values to their labels', () => {
    expect(orientationLabel(1)).toBe('Normal')
    expect(orientationLabel(3)).toBe('Rotated 180°')
    expect(orientationLabel(6)).toBe('Rotated 90° CW')
  })

  it('falls back to an "Unknown (n)" label for out-of-range values', () => {
    expect(orientationLabel(42)).toBe('Unknown (42)')
  })
})

describe('formatExposureTime', () => {
  it('returns undefined for missing/zero/negative values', () => {
    expect(formatExposureTime(undefined)).toBeUndefined()
    expect(formatExposureTime(0)).toBeUndefined()
    expect(formatExposureTime(-1)).toBeUndefined()
  })

  it('formats sub-1-second exposures as a 1/N fraction', () => {
    expect(formatExposureTime(1 / 125)).toBe('1/125 s')
    expect(formatExposureTime(1 / 60)).toBe('1/60 s')
    expect(formatExposureTime(0.008)).toBe('1/125 s')
  })

  it('formats 1-second-or-longer exposures as decimal seconds', () => {
    expect(formatExposureTime(1)).toBe('1.0 s')
    expect(formatExposureTime(2.5)).toBe('2.5 s')
  })
})

describe('dmsToDecimalDegrees', () => {
  it('converts a degrees/minutes/seconds triple to decimal degrees', () => {
    // 37° 46' 29.9" -> 37 + 46/60 + 29.9/3600
    const result = dmsToDecimalDegrees([37, 46, 29.9])
    expect(result).toBeCloseTo(37.7749722, 5)
  })

  it('handles a whole-degrees-only single-element array', () => {
    expect(dmsToDecimalDegrees([37])).toBe(37)
  })

  it('returns undefined for an empty array', () => {
    expect(dmsToDecimalDegrees([])).toBeUndefined()
  })

  it('handles zero minutes/seconds', () => {
    expect(dmsToDecimalDegrees([10, 0, 0])).toBe(10)
  })
})
