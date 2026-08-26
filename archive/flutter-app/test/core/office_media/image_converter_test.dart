import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:infrakit_studio/core/office_media/image_converter.dart';

/// A small, uniformly-colored source image — enough to prove format
/// conversion round-trips dimensions correctly.
Uint8List _flatColorPngBytes({int width = 20, int height = 20}) {
  final image = img.Image(width: width, height: height);
  img.fill(image, color: img.ColorRgb8(200, 60, 30));
  return img.encodePng(image);
}

/// A larger image with per-pixel pseudo-random color noise. Flat-color
/// images compress to nearly the same tiny size at any JPEG quality
/// (DC-only blocks), so a noisy image is needed to actually observe quality
/// affecting output size.
Uint8List _noisyPngBytes({int width = 64, int height = 64, int seed = 7}) {
  final random = Random(seed);
  final image = img.Image(width: width, height: height);
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      image.setPixelRgb(
        x,
        y,
        random.nextInt(256),
        random.nextInt(256),
        random.nextInt(256),
      );
    }
  }
  return img.encodePng(image);
}

void main() {
  const converter = ImageConverter();

  group('ImageConverter', () {
    test('PNG -> JPEG round-trips to the same dimensions', () {
      final source = _flatColorPngBytes(width: 20, height: 20);

      final result = converter.execute(
        ImageConversionInput(
          sourceBytes: source,
          targetFormat: ImageOutputFormat.jpeg,
          quality: 85,
        ),
      );

      final decodedOutput = img.decodeImage(result.outputBytes);
      expect(decodedOutput, isNotNull);
      expect(decodedOutput!.width, 20);
      expect(decodedOutput.height, 20);
      expect(result.outputFormat, ImageOutputFormat.jpeg);
      expect(result.sourceByteSize, source.length);
      expect(result.outputByteSize, result.outputBytes.length);
    });

    test('PNG -> WebP round-trips to the same dimensions', () {
      final source = _flatColorPngBytes(width: 20, height: 20);

      final result = converter.execute(
        ImageConversionInput(
          sourceBytes: source,
          targetFormat: ImageOutputFormat.webp,
        ),
      );

      final decodedOutput = img.decodeImage(result.outputBytes);
      expect(decodedOutput, isNotNull);
      expect(decodedOutput!.width, 20);
      expect(decodedOutput.height, 20);
      expect(result.outputFormat, ImageOutputFormat.webp);
    });

    test('JPEG -> PNG round-trips to the same dimensions', () {
      final flatImage = img.Image(width: 12, height: 8);
      img.fill(flatImage, color: img.ColorRgb8(10, 200, 90));
      final jpegSource = img.encodeJpg(flatImage, quality: 90);

      final result = converter.execute(
        ImageConversionInput(
          sourceBytes: jpegSource,
          targetFormat: ImageOutputFormat.png,
        ),
      );

      final decodedOutput = img.decodeImage(result.outputBytes);
      expect(decodedOutput, isNotNull);
      expect(decodedOutput!.width, 12);
      expect(decodedOutput.height, 8);
      expect(result.outputFormat, ImageOutputFormat.png);
    });

    test('lower JPEG quality produces smaller output than higher quality', () {
      final source = _noisyPngBytes();

      final highQuality = converter.execute(
        ImageConversionInput(
          sourceBytes: source,
          targetFormat: ImageOutputFormat.jpeg,
          quality: 95,
        ),
      );
      final lowQuality = converter.execute(
        ImageConversionInput(
          sourceBytes: source,
          targetFormat: ImageOutputFormat.jpeg,
          quality: 10,
        ),
      );

      expect(lowQuality.outputByteSize, lessThan(highQuality.outputByteSize));
      expect(lowQuality.compressionRatio, lessThan(highQuality.compressionRatio));
    });

    test('resize (maxWidth/maxHeight) shrinks output dimensions and preserves aspect ratio', () {
      final source = _flatColorPngBytes(width: 100, height: 50);

      final result = converter.execute(
        ImageConversionInput(
          sourceBytes: source,
          targetFormat: ImageOutputFormat.png,
          maxWidth: 50,
        ),
      );

      expect(result.sourceWidth, 100);
      expect(result.sourceHeight, 50);
      expect(result.outputWidth, 50);
      expect(result.outputHeight, 25); // aspect ratio preserved
    });

    test('throws FormatException for undecodable bytes', () {
      final garbage = Uint8List.fromList(List.generate(32, (i) => i));

      expect(
        () => converter.execute(
          ImageConversionInput(
            sourceBytes: garbage,
            targetFormat: ImageOutputFormat.png,
          ),
        ),
        throwsFormatException,
      );
    });

    test('throws ArgumentError for out-of-range quality', () {
      final source = _flatColorPngBytes();

      expect(
        () => converter.execute(
          ImageConversionInput(
            sourceBytes: source,
            targetFormat: ImageOutputFormat.jpeg,
            quality: 150,
          ),
        ),
        throwsArgumentError,
      );
    });
  });
}
