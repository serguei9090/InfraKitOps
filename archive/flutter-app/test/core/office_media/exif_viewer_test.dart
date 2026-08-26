import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:infrakit_studio/core/office_media/exif_viewer.dart';

/// Packs a list of (numerator, denominator) pairs into big-endian bytes
/// matching the on-disk layout `package:image`'s `IfdValueRational.data`
/// constructor expects — used to build a genuine 3-element EXIF GPS
/// degrees/minutes/seconds rational triple via the package's own public
/// `InputBuffer` API (there is no public constructor that builds a
/// multi-element rational list directly, since `Rational` itself isn't
/// exported from `package:image`).
Uint8List _packRationalPairs(List<List<int>> pairs) {
  final bytes = ByteData(pairs.length * 8);
  for (var i = 0; i < pairs.length; i++) {
    bytes.setUint32(i * 8, pairs[i][0], Endian.big);
    bytes.setUint32(i * 8 + 4, pairs[i][1], Endian.big);
  }
  return bytes.buffer.asUint8List();
}

img.IfdValueRational _rationalTriplet(List<List<int>> pairs) {
  final buffer = img.InputBuffer(_packRationalPairs(pairs), bigEndian: true);
  return img.IfdValueRational.data(buffer, pairs.length);
}

void main() {
  const viewer = ExifViewer();

  group('ExifViewer', () {
    test('image with no EXIF segment returns an empty result without throwing', () {
      final image = img.Image(width: 10, height: 10);
      img.fill(image, color: img.ColorRgb8(0, 0, 0));
      // PNG never carries EXIF in package:image, so this is a clean "no
      // EXIF at all" source — the common case (screenshots, most PNGs).
      final pngBytes = img.encodePng(image);

      final metadata = viewer.execute(pngBytes);

      expect(metadata.isEmpty, isTrue);
      expect(metadata.cameraMake, isNull);
      expect(metadata.gps, isNull);
    });

    test('throws FormatException for undecodable bytes', () {
      final garbage = Uint8List.fromList(List.generate(32, (i) => i));
      expect(() => viewer.execute(garbage), throwsFormatException);
    });

    test('camera/exposure tags round-trip through a real JPEG EXIF segment', () {
      final image = img.Image(width: 16, height: 16);
      img.fill(image, color: img.ColorRgb8(120, 130, 140));

      image.exif.imageIfd
        ..make = 'Canon'
        ..model = 'EOS R5'
        ..software = 'InfraKit Test Rig';

      final exifIfd = image.exif.exifIfd;
      exifIfd[0x9003] = img.IfdValueAscii('2024:03:17 14:22:05'); // DateTimeOriginal
      exifIfd[0x829A] = img.IfdValueRational(1, 200); // ExposureTime 1/200s
      exifIfd[0x829D] = img.IfdValueRational(28, 10); // FNumber f/2.8
      exifIfd[0x8827] = img.IfdValueLong(400); // ISOSpeed
      exifIfd[0x920A] = img.IfdValueRational(50, 1); // FocalLength 50mm
      exifIfd[0xA434] = img.IfdValueAscii('RF 50mm F1.2L'); // LensModel

      // Encoding to JPEG is required for a genuine round-trip: package:image's
      // PNG encoder never writes an EXIF segment at all, only its JPEG
      // encoder does.
      final jpegBytes = img.encodeJpg(image, quality: 95);

      final metadata = viewer.execute(jpegBytes);

      expect(metadata.isEmpty, isFalse);
      expect(metadata.cameraMake, 'Canon');
      expect(metadata.cameraModel, 'EOS R5');
      expect(metadata.software, 'InfraKit Test Rig');
      expect(metadata.lensModel, 'RF 50mm F1.2L');
      expect(metadata.dateTimeOriginal, '2024:03:17 14:22:05');
      expect(metadata.exposureTime, '1/200 s');
      expect(metadata.fNumber, closeTo(2.8, 0.001));
      expect(metadata.isoSpeed, 400);
      expect(metadata.focalLengthMm, closeTo(50.0, 0.001));
      expect(metadata.gps, isNull);
    });

    test(
      'orientation tag is null after a JPEG round-trip, because package:image '
      'bakes it into the pixel data and clears the tag on decode',
      () {
        final image = img.Image(width: 4, height: 4);
        img.fill(image, color: img.ColorRgb8(1, 2, 3));
        image.exif.imageIfd.orientation = 6;

        final jpegBytes = img.encodeJpg(image, quality: 95);
        final metadata = viewer.execute(jpegBytes);

        // This documents real package:image behavior (see the doc comment
        // on ExifMetadata.orientation), not a limitation of ExifViewer's
        // own tag-reading logic: the tag genuinely is gone from the
        // decoded ExifData, orientation was already applied to the pixels.
        expect(metadata.orientation, isNull);
      },
    );

    test('GPS degrees/minutes/seconds round-trip to correct decimal degrees', () {
      final image = img.Image(width: 8, height: 8);
      img.fill(image, color: img.ColorRgb8(50, 60, 70));

      final gpsIfd = image.exif.gpsIfd;
      // 37 deg 46' 29.97" N, 122 deg 25' 39.96" W, 15m above sea level.
      gpsIfd[0x0001] = img.IfdValueAscii('N'); // GPSLatitudeRef
      gpsIfd[0x0002] = _rationalTriplet([
        [37, 1],
        [46, 1],
        [2997, 100],
      ]); // GPSLatitude
      gpsIfd[0x0003] = img.IfdValueAscii('W'); // GPSLongitudeRef
      gpsIfd[0x0004] = _rationalTriplet([
        [122, 1],
        [25, 1],
        [3996, 100],
      ]); // GPSLongitude
      gpsIfd[0x0005] = img.IfdByteValue(0); // GPSAltitudeRef: 0 = above sea level
      gpsIfd[0x0006] = img.IfdValueRational(15, 1); // GPSAltitude

      final jpegBytes = img.encodeJpg(image, quality: 95);

      final metadata = viewer.execute(jpegBytes);

      expect(metadata.gps, isNotNull);
      final expectedLat = 37 + 46 / 60 + 29.97 / 3600;
      final expectedLon = -(122 + 25 / 60 + 39.96 / 3600);
      expect(metadata.gps!.latitude, closeTo(expectedLat, 0.0001));
      expect(metadata.gps!.longitude, closeTo(expectedLon, 0.0001));
      expect(metadata.gps!.altitudeMeters, closeTo(15.0, 0.001));
    });

    test('GPS below-sea-level altitude ref negates the altitude', () {
      final image = img.Image(width: 8, height: 8);
      img.fill(image, color: img.ColorRgb8(10, 10, 10));

      final gpsIfd = image.exif.gpsIfd;
      gpsIfd[0x0001] = img.IfdValueAscii('S');
      gpsIfd[0x0002] = _rationalTriplet([
        [1, 1],
        [0, 1],
        [0, 1],
      ]);
      gpsIfd[0x0003] = img.IfdValueAscii('E');
      gpsIfd[0x0004] = _rationalTriplet([
        [1, 1],
        [0, 1],
        [0, 1],
      ]);
      gpsIfd[0x0005] = img.IfdByteValue(1); // below sea level
      gpsIfd[0x0006] = img.IfdValueRational(5, 1);

      final jpegBytes = img.encodeJpg(image, quality: 95);
      final metadata = viewer.execute(jpegBytes);

      expect(metadata.gps!.latitude, closeTo(-1.0, 0.0001)); // S -> negative
      expect(metadata.gps!.longitude, closeTo(1.0, 0.0001)); // E -> positive
      expect(metadata.gps!.altitudeMeters, closeTo(-5.0, 0.001));
    });
  });
}
