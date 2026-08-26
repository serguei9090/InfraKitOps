import 'dart:typed_data';

import 'package:image/image.dart' as img;

import '../ports/i_tool_use_case.dart';

/// GPS coordinates decoded from EXIF's degrees/minutes/seconds rational
/// triples into plain decimal degrees, with the hemisphere reference (N/S,
/// E/W) already folded into the sign.
class ExifGpsCoordinates {
  const ExifGpsCoordinates({
    required this.latitude,
    required this.longitude,
    this.altitudeMeters,
  });

  /// Decimal degrees. Positive = North, negative = South.
  final double latitude;

  /// Decimal degrees. Positive = East, negative = West.
  final double longitude;

  /// Meters above (positive) or below (negative) sea level, if present.
  final double? altitudeMeters;
}

/// Plain, package-agnostic EXIF metadata snapshot. This is what the UI
/// consumes — it never sees `package:image`'s `ExifData`/`IfdValue` types.
class ExifMetadata {
  const ExifMetadata({
    this.cameraMake,
    this.cameraModel,
    this.lensModel,
    this.software,
    this.dateTimeOriginal,
    this.exposureTime,
    this.fNumber,
    this.isoSpeed,
    this.focalLengthMm,
    this.orientation,
    this.gps,
  });

  final String? cameraMake;
  final String? cameraModel;
  final String? lensModel;
  final String? software;

  /// Raw EXIF `DateTimeOriginal` string (EXIF's own format, e.g.
  /// `"2024:03:17 14:22:05"`) — left unparsed since EXIF's date format is
  /// not ISO-8601 and callers may want to display it verbatim.
  final String? dateTimeOriginal;

  /// Formatted like `"1/125 s"` or `"2 s"`.
  final String? exposureTime;

  /// Aperture, e.g. `2.8` (displayed as `f/2.8`).
  final double? fNumber;

  final int? isoSpeed;
  final double? focalLengthMm;

  /// Raw EXIF orientation tag value (1-8). See [orientationLabel] for a
  /// human-readable description.
  ///
  /// For JPEGs decoded through `package:image` this is almost always
  /// `null` even when the original file had a non-default orientation:
  /// `package:image`'s JPEG decoder physically rotates/flips the pixel
  /// data to match the tag and then clears it (`orientation = null`) so
  /// downstream code doesn't double-rotate. So the *pixels* you see are
  /// already orientation-corrected — this field only ever reports a
  /// value for formats/paths that don't do that normalization.
  final int? orientation;

  final ExifGpsCoordinates? gps;

  /// True when none of the fields above were found — the "no EXIF data"
  /// case the UI should render as an empty state rather than a bug.
  bool get isEmpty =>
      cameraMake == null &&
      cameraModel == null &&
      lensModel == null &&
      software == null &&
      dateTimeOriginal == null &&
      exposureTime == null &&
      fNumber == null &&
      isoSpeed == null &&
      focalLengthMm == null &&
      orientation == null &&
      gps == null;

  static const _orientationLabels = {
    1: 'Normal',
    2: 'Mirrored horizontally',
    3: 'Rotated 180°',
    4: 'Mirrored vertically',
    5: 'Mirrored horizontally, rotated 90° CW',
    6: 'Rotated 90° CW',
    7: 'Mirrored horizontally, rotated 90° CCW',
    8: 'Rotated 90° CCW',
  };

  String? get orientationLabel =>
      orientation == null ? null : (_orientationLabels[orientation] ?? 'Unknown ($orientation)');
}

/// EXIF Metadata Viewer (spec 3.2): decodes an image and extracts the EXIF
/// tags a human actually cares about (camera info, exposure settings, GPS)
/// into [ExifMetadata], a plain data class with no `package:image` types in
/// its public surface.
///
/// Images with no EXIF segment at all (most PNGs, screenshots, re-saved
/// web images) are the common case and are handled gracefully: [execute]
/// returns an empty [ExifMetadata] (`isEmpty == true`) rather than throwing.
///
/// ## GPS decoding depth
/// EXIF stores `GPSLatitude`/`GPSLongitude` as a **3-element rational
/// array** (degrees, minutes, seconds — each a numerator/denominator pair),
/// with a separate single-letter `GPSLatitudeRef`/`GPSLongitudeRef` tag
/// ("N"/"S", "E"/"W") carrying the sign. This class reads that raw tag
/// value directly (via `IfdDirectory`'s indexer, tags `0x0002`/`0x0004`)
/// and converts `deg + min/60 + sec/3600` into decimal degrees itself.
///
/// This is deliberate: `package:image` 4.9.2's own `IfdDirectory.
/// gpsLatitude`/`gpsLongitude` convenience getters call `IfdValue.toDouble()`
/// with no index, which only reads the *first* rational element (i.e. just
/// the whole-degrees part) — they do not perform the DMS-to-decimal
/// conversion a real GPS-tagged photo needs. Using those getters directly
/// would silently truncate e.g. `37° 46' 29.9" N` down to `37.0`. GPS
/// altitude (`0x0006`, with the below/above-sea-level flag in `0x0005`) is
/// decoded the same way, reading the raw tag rather than a convenience
/// getter.
class ExifViewer implements IToolUseCase<Uint8List, ExifMetadata> {
  const ExifViewer();

  // EXIF sub-IFD tag IDs (see exif_tag.dart in package:image).
  static const _tagDateTimeOriginal = 0x9003;
  static const _tagExposureTime = 0x829A;
  static const _tagFNumber = 0x829D;
  static const _tagIsoSpeed = 0x8827;
  static const _tagFocalLength = 0x920A;
  static const _tagLensModel = 0xA434;

  // GPS sub-IFD tag IDs.
  static const _tagGpsLatitude = 0x0002;
  static const _tagGpsLongitude = 0x0004;
  static const _tagGpsAltitudeRef = 0x0005;
  static const _tagGpsAltitude = 0x0006;

  @override
  ExifMetadata execute(Uint8List sourceBytes) {
    final decoded = img.decodeImage(sourceBytes);
    if (decoded == null) {
      throw FormatException(
        'Could not decode image: unrecognized or corrupt image data',
      );
    }

    if (!decoded.hasExif || decoded.exif.isEmpty) {
      return const ExifMetadata();
    }

    final exif = decoded.exif;
    final imageIfd = exif.imageIfd;
    final exifIfd = exif.exifIfd;
    final gpsIfd = exif.gpsIfd;

    return ExifMetadata(
      cameraMake: _cleanString(imageIfd.make),
      cameraModel: _cleanString(imageIfd.model),
      lensModel: _cleanString(exifIfd[_tagLensModel]?.toString()),
      software: _cleanString(imageIfd.software),
      dateTimeOriginal: _cleanString(exifIfd[_tagDateTimeOriginal]?.toString()),
      exposureTime: _formatExposureTime(exifIfd[_tagExposureTime]),
      fNumber: exifIfd[_tagFNumber]?.toDouble(),
      isoSpeed: exifIfd[_tagIsoSpeed]?.toInt(),
      focalLengthMm: exifIfd[_tagFocalLength]?.toDouble(),
      orientation: imageIfd.hasOrientation ? imageIfd.orientation : null,
      gps: _readGps(gpsIfd),
    );
  }

  String? _cleanString(String? value) {
    if (value == null) return null;
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  String? _formatExposureTime(img.IfdValue? value) {
    if (value == null) return null;
    final rational = value.toRational();
    if (rational.numerator <= 0 || rational.denominator <= 0) return null;
    if (rational.numerator == 1) {
      return '1/${rational.denominator} s';
    }
    final seconds = rational.numerator / rational.denominator;
    return '${seconds.toStringAsFixed(seconds >= 1 ? 1 : 3)} s';
  }

  /// Converts a raw EXIF GPS rational-triple tag (degrees, minutes,
  /// seconds) into decimal degrees. Falls back to reading a single value
  /// directly if the tag isn't the standard 3-element form (e.g. data
  /// written by a tool that stores decimal degrees directly).
  double? _dmsToDecimalDegrees(img.IfdValue? value) {
    if (value == null) return null;
    if (value.length >= 3) {
      final degrees = value.toDouble(0);
      final minutes = value.toDouble(1);
      final seconds = value.toDouble(2);
      return degrees + minutes / 60.0 + seconds / 3600.0;
    }
    if (value.length >= 1) {
      return value.toDouble(0);
    }
    return null;
  }

  ExifGpsCoordinates? _readGps(img.IfdDirectory gpsIfd) {
    final rawLatitude = gpsIfd[_tagGpsLatitude];
    final rawLongitude = gpsIfd[_tagGpsLongitude];
    var latitude = _dmsToDecimalDegrees(rawLatitude);
    var longitude = _dmsToDecimalDegrees(rawLongitude);
    if (latitude == null || longitude == null) {
      return null;
    }

    if (gpsIfd.gpsLatitudeRef?.toUpperCase() == 'S') {
      latitude = -latitude;
    }
    if (gpsIfd.gpsLongitudeRef?.toUpperCase() == 'W') {
      longitude = -longitude;
    }

    double? altitude = gpsIfd[_tagGpsAltitude]?.toDouble();
    if (altitude != null && gpsIfd[_tagGpsAltitudeRef]?.toInt() == 1) {
      altitude = -altitude;
    }

    return ExifGpsCoordinates(
      latitude: latitude,
      longitude: longitude,
      altitudeMeters: altitude,
    );
  }
}
