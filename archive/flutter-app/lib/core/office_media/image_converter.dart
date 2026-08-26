import 'dart:typed_data';

import 'package:image/image.dart' as img;

import '../ports/i_tool_use_case.dart';

/// Target raster format for [ImageConverter].
enum ImageOutputFormat {
  jpeg('JPEG', 'jpg'),
  png('PNG', 'png'),
  webp('WebP', 'webp');

  const ImageOutputFormat(this.label, this.extension);

  final String label;
  final String extension;
}

class ImageConversionInput {
  const ImageConversionInput({
    required this.sourceBytes,
    required this.targetFormat,
    this.quality = 85,
    this.maxWidth,
    this.maxHeight,
  });

  /// Raw bytes of the source image, in any format `package:image` can
  /// auto-detect (JPEG, PNG, GIF, BMP, TGA, WebP-lossless, ...).
  final Uint8List sourceBytes;

  final ImageOutputFormat targetFormat;

  /// 0-100. Used verbatim for JPEG (libjpeg-style quality). For PNG this is
  /// remapped to the 0-9 zlib compression-*effort* level (PNG is always
  /// lossless — a higher "quality" here just means more CPU spent finding a
  /// smaller file, not lower fidelity). Ignored for WebP: see the doc
  /// comment on [ImageConverter] for why.
  final int quality;

  /// Optional resize bounds, applied before encoding. Aspect ratio is
  /// preserved (matching `package:image`'s `copyResize(maintainAspect:
  /// true)`), so the output may be smaller than the exact box requested.
  final int? maxWidth;
  final int? maxHeight;
}

class ImageConversionResult {
  const ImageConversionResult({
    required this.outputBytes,
    required this.outputFormat,
    required this.sourceByteSize,
    required this.outputByteSize,
    required this.sourceWidth,
    required this.sourceHeight,
    required this.outputWidth,
    required this.outputHeight,
  });

  final Uint8List outputBytes;
  final ImageOutputFormat outputFormat;

  final int sourceByteSize;
  final int outputByteSize;

  final int sourceWidth;
  final int sourceHeight;
  final int outputWidth;
  final int outputHeight;

  /// outputByteSize / sourceByteSize. Less than 1.0 means the output is
  /// smaller than the source; e.g. 0.4 means the output is 40% of the
  /// original size (a 60% reduction).
  double get compressionRatio =>
      sourceByteSize == 0 ? 0 : outputByteSize / sourceByteSize;

  int get bytesSaved => sourceByteSize - outputByteSize;

  /// Positive when the output shrank, negative when it grew (can happen —
  /// e.g. re-encoding a highly-optimized small PNG as JPEG at high quality).
  double get percentSaved =>
      sourceByteSize == 0 ? 0 : (bytesSaved / sourceByteSize) * 100;
}

/// Image Format Converter & Compressor (spec 3.2): converts between JPEG,
/// PNG and WebP and optionally resizes/recompresses along the way, built
/// entirely on `package:image`'s pure-Dart codecs so it has zero platform
/// dependency and is safely unit-testable.
///
/// Source format is auto-detected from the bytes via `img.decodeImage()` —
/// callers never need to say what the input is, only what they want out.
///
/// WebP caveat: `package:image` 4.9.2's `WebPEncoder` only implements the
/// **lossless VP8L** bitstream — there is no lossy VP8 encoder and therefore
/// no quality knob for WebP output in this package. Converting *to* WebP
/// here always produces a lossless file regardless of [ImageConversionInput.
/// quality]; that field is silently ignored for that target. (Decoding WebP,
/// including lossy VP8 files produced by other tools, is still supported —
/// this limitation is encode-only.) If true lossy WebP output is ever
/// required, a native binding (e.g. `libwebp`) would be needed instead.
class ImageConverter
    implements IToolUseCase<ImageConversionInput, ImageConversionResult> {
  const ImageConverter();

  @override
  ImageConversionResult execute(ImageConversionInput input) {
    if (input.quality < 0 || input.quality > 100) {
      throw ArgumentError.value(
        input.quality,
        'quality',
        'Must be between 0 and 100',
      );
    }
    if ((input.maxWidth != null && input.maxWidth! <= 0) ||
        (input.maxHeight != null && input.maxHeight! <= 0)) {
      throw ArgumentError('maxWidth/maxHeight must be positive when given');
    }

    final decoded = img.decodeImage(input.sourceBytes);
    if (decoded == null) {
      throw FormatException(
        'Could not decode image: unrecognized or corrupt image data',
      );
    }

    var working = decoded;
    if (input.maxWidth != null || input.maxHeight != null) {
      working = img.copyResize(
        working,
        width: input.maxWidth,
        height: input.maxHeight,
        maintainAspect: true,
        interpolation: img.Interpolation.average,
      );
    }

    final Uint8List outputBytes;
    switch (input.targetFormat) {
      case ImageOutputFormat.jpeg:
        outputBytes = img.encodeJpg(working, quality: input.quality.clamp(1, 100).toInt());
      case ImageOutputFormat.png:
        outputBytes = img.encodePng(working, level: _pngLevelFromQuality(input.quality));
      case ImageOutputFormat.webp:
        // No quality parameter exists on this encoder — see class doc.
        outputBytes = img.encodeWebP(working);
    }

    return ImageConversionResult(
      outputBytes: outputBytes,
      outputFormat: input.targetFormat,
      sourceByteSize: input.sourceBytes.length,
      outputByteSize: outputBytes.length,
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      outputWidth: working.width,
      outputHeight: working.height,
    );
  }

  /// Maps the familiar 0-100 "quality" scale onto PNG's 0-9 deflate
  /// compression-effort level, so the UI can offer a single slider even
  /// though PNG has no lossy quality concept.
  int _pngLevelFromQuality(int quality) =>
      (quality.clamp(0, 100) / 100 * 9).round().clamp(0, 9);
}
