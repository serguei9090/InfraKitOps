import exifr from 'exifr'
import type { IToolUseCase } from '../ports/IToolUseCase'

/** GPS coordinates in plain decimal degrees, with the hemisphere reference (N/S, E/W)
 * already folded into the sign. */
export interface ExifGpsCoordinates {
  /** Decimal degrees. Positive = North, negative = South. */
  latitude: number
  /** Decimal degrees. Positive = East, negative = West. */
  longitude: number
  /** Meters above (positive) or below (negative) sea level, if present. */
  altitudeMeters?: number
}

/** Plain, library-agnostic EXIF metadata snapshot. This is what the UI consumes — it
 * never sees `exifr`'s raw tag-object output. */
export interface ExifMetadata {
  cameraMake?: string
  cameraModel?: string
  lensModel?: string
  software?: string
  /** Raw EXIF `DateTimeOriginal` string (EXIF's own format, e.g.
   * `"2024:03:17 14:22:05"`) — left unparsed since EXIF's date format is not
   * ISO-8601 and callers may want to display it verbatim. */
  dateTimeOriginal?: string
  /** Formatted like `"1/125 s"` or `"2.0 s"`. */
  exposureTime?: string
  /** Aperture, e.g. `2.8` (displayed as `f/2.8`). */
  fNumber?: number
  isoSpeed?: number
  focalLengthMm?: number
  /** Raw EXIF orientation tag value (1-8). See {@link orientationLabel} for a
   * human-readable description. Most JPEGs decoded by browsers/photo tools already
   * have this baked into the pixels and cleared from the tag, so it's commonly
   * absent even on a photo that was originally rotated. */
  orientation?: number
  gps?: ExifGpsCoordinates
}

/** True when none of {@link ExifMetadata}'s fields were found — the "no EXIF data"
 * case the UI should render as an empty state rather than a bug. */
export function isEmptyMetadata(metadata: ExifMetadata): boolean {
  return (
    metadata.cameraMake == null &&
    metadata.cameraModel == null &&
    metadata.lensModel == null &&
    metadata.software == null &&
    metadata.dateTimeOriginal == null &&
    metadata.exposureTime == null &&
    metadata.fNumber == null &&
    metadata.isoSpeed == null &&
    metadata.focalLengthMm == null &&
    metadata.orientation == null &&
    metadata.gps == null
  )
}

const ORIENTATION_LABELS: Record<number, string> = {
  1: 'Normal',
  2: 'Mirrored horizontally',
  3: 'Rotated 180°',
  4: 'Mirrored vertically',
  5: 'Mirrored horizontally, rotated 90° CW',
  6: 'Rotated 90° CW',
  7: 'Mirrored horizontally, rotated 90° CCW',
  8: 'Rotated 90° CCW',
}

export function orientationLabel(orientation: number | undefined): string | undefined {
  if (orientation == null) return undefined
  return ORIENTATION_LABELS[orientation] ?? `Unknown (${orientation})`
}

/**
 * Formats a decimal exposure-time-in-seconds value (the shape `exifr` returns for the
 * `ExposureTime` tag) into a human string, e.g. `0.008` -> `"1/125 s"`,
 * `2` -> `"2.0 s"`.
 *
 * Note: the Dart core (`package:image`) had access to the original EXIF rational
 * numerator/denominator and switched formats based on whether the numerator was
 * exactly 1. `exifr` only exposes the already-divided decimal seconds value, not the
 * raw rational, so sub-1-second exposures are reconstructed as `1/round(1/seconds)`
 * instead — visually identical for the overwhelming majority of real camera exposure
 * times (which are themselves unit-numerator fractions like 1/125, 1/60, ...).
 */
export function formatExposureTime(seconds: number | undefined): string | undefined {
  if (seconds == null || !(seconds > 0)) return undefined
  if (seconds < 1) {
    return `1/${Math.round(1 / seconds)} s`
  }
  return `${seconds.toFixed(1)} s`
}

/**
 * Converts a raw EXIF GPS degrees/minutes/seconds rational triple into decimal
 * degrees (`deg + min/60 + sec/3600`). Falls back to reading a single value directly
 * if given fewer than 3 elements (e.g. data written by a tool that stores decimal
 * degrees directly). Pure and synchronous — used as a fallback for when `exifr`'s own
 * computed `latitude`/`longitude` output (from the `{gps: true}` parse option) isn't
 * present in the parsed result.
 */
export function dmsToDecimalDegrees(dms: readonly number[]): number | undefined {
  if (dms.length >= 3) {
    const [degrees, minutes, seconds] = dms
    return (degrees ?? 0) + (minutes ?? 0) / 60 + (seconds ?? 0) / 3600
  }
  if (dms.length >= 1) return dms[0]
  return undefined
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * EXIF Metadata Viewer (spec 3.2): reads an image's EXIF tags via `exifr` (a pure-JS,
 * browser-safe library) and normalizes the handful of tags a human actually cares
 * about (camera info, exposure settings, GPS) into {@link ExifMetadata}, a plain data
 * shape with no `exifr`-specific types in its public surface — the same role the Dart
 * core played over `package:image`'s raw EXIF types.
 *
 * Images with no EXIF segment at all (most PNGs, screenshots, re-saved web images)
 * are the common case and are handled gracefully: `execute` resolves to an empty
 * {@link ExifMetadata} (`isEmptyMetadata() === true`) rather than throwing.
 *
 * ## GPS decoding
 * `exifr`'s `{gps: true}` parse option (used here) computes ready-to-use decimal
 * `latitude`/`longitude` output fields itself (already sign-adjusted for the N/S,
 * E/W hemisphere reference) — unlike `package:image`, which required this class to
 * do the degrees/minutes/seconds-to-decimal conversion by hand. Those computed
 * fields are used when present; {@link dmsToDecimalDegrees} remains as a defensive
 * fallback over the raw `GPSLatitude`/`GPSLongitude` rational-triple tags for the
 * rare case they're missing.
 */
export class ExifViewer implements IToolUseCase<File | Blob | ArrayBuffer | Uint8Array, ExifMetadata> {
  async execute(input: File | Blob | ArrayBuffer | Uint8Array): Promise<ExifMetadata> {
    let raw: Record<string, unknown> | undefined
    try {
      raw = await exifr.parse(input, { gps: true, reviveValues: false })
    } catch (e) {
      throw new Error(`Could not read EXIF metadata: ${e instanceof Error ? e.message : String(e)}`)
    }

    if (!raw) return {}

    return {
      cameraMake: cleanString(raw.Make),
      cameraModel: cleanString(raw.Model),
      lensModel: cleanString(raw.LensModel),
      software: cleanString(raw.Software),
      dateTimeOriginal: cleanString(raw.DateTimeOriginal),
      exposureTime: formatExposureTime(asNumber(raw.ExposureTime)),
      fNumber: asNumber(raw.FNumber),
      isoSpeed: asNumber(raw.ISO),
      focalLengthMm: asNumber(raw.FocalLength),
      orientation: asNumber(raw.Orientation),
      gps: this.readGps(raw),
    }
  }

  private readGps(raw: Record<string, unknown>): ExifGpsCoordinates | undefined {
    let latitude = asNumber(raw.latitude)
    let longitude = asNumber(raw.longitude)

    if (latitude == null && Array.isArray(raw.GPSLatitude)) {
      latitude = dmsToDecimalDegrees(raw.GPSLatitude as number[])
      if (latitude != null && raw.GPSLatitudeRef === 'S') latitude = -latitude
    }
    if (longitude == null && Array.isArray(raw.GPSLongitude)) {
      longitude = dmsToDecimalDegrees(raw.GPSLongitude as number[])
      if (longitude != null && raw.GPSLongitudeRef === 'W') longitude = -longitude
    }

    if (latitude == null || longitude == null) return undefined

    let altitudeMeters = asNumber(raw.GPSAltitude)
    if (altitudeMeters != null && raw.GPSAltitudeRef === 1) altitudeMeters = -altitudeMeters

    return { latitude, longitude, altitudeMeters }
  }
}
