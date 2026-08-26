import 'dart:convert';
import 'dart:typed_data';

import 'package:archive/archive.dart';

import '../ports/i_tool_use_case.dart';

/// What [GzipConverter] should do with the bytes it is handed.
enum GzipOperation {
  compress('Compress'),
  decompress('Decompress');

  const GzipOperation(this.label);

  final String label;
}

class GzipConversionInput {
  const GzipConversionInput({required this.data, required this.operation, this.level});

  /// Raw bytes to compress, or the gzip stream to decompress.
  final Uint8List data;

  final GzipOperation operation;

  /// Deflate level 0-9 (compress only). Null uses the encoder default (6).
  final int? level;
}

class GzipConversionResult {
  const GzipConversionResult({
    required this.data,
    required this.inputSize,
    required this.operation,
  });

  /// The produced bytes: the gzip stream when compressing, the recovered
  /// payload when decompressing.
  final Uint8List data;

  final int inputSize;
  final GzipOperation operation;

  int get outputSize => data.length;

  /// Size of the payload in its uncompressed form, whichever side of the
  /// conversion it happened to be on.
  int get originalSize => operation == GzipOperation.compress ? inputSize : outputSize;

  /// Size of the payload in its gzip form.
  int get compressedSize => operation == GzipOperation.compress ? outputSize : inputSize;

  /// compressed / original. 0.12 means the gzip stream is 12% of the
  /// original size. Values above 1 are possible (and normal) for tiny or
  /// already-compressed inputs, because gzip adds an 18-byte frame.
  double get compressionRatio => originalSize == 0 ? 0 : compressedSize / originalSize;

  /// How much was saved, as a percentage. Negative when gzip made the
  /// payload bigger.
  double get spaceSavingPercent => originalSize == 0 ? 0 : (1 - compressionRatio) * 100;

  /// The output bytes as standard Base64 — how gzipped payloads normally
  /// travel when they have to be pasted into a config file, ticket or shell.
  String get base64 => base64Encode(data);

  /// The output bytes decoded as UTF-8 text, or null when they are not
  /// valid UTF-8 (i.e. the payload is genuinely binary).
  String? get textOrNull {
    try {
      return utf8.decode(data);
    } on FormatException {
      return null;
    }
  }
}

/// GZip compression/decompression built on `package:archive`, which picks a
/// native codec on `dart:io` platforms and a pure-Dart Deflate/Inflate on
/// web — so unlike `dart:io`'s `GZipCodec` this works everywhere the app
/// runs.
///
/// Every failure path (garbage input, truncated stream, bad level) leaves
/// this class as an [ArgumentError] or [FormatException]; nothing from the
/// underlying codec escapes uncaught.
class GzipConverter implements IToolUseCase<GzipConversionInput, GzipConversionResult> {
  const GzipConverter();

  /// First two bytes of every gzip stream (RFC 1952 §2.3.1).
  static const int _magic0 = 0x1f;
  static const int _magic1 = 0x8b;

  @override
  GzipConversionResult execute(GzipConversionInput input) {
    switch (input.operation) {
      case GzipOperation.compress:
        return _compress(input.data, input.level);
      case GzipOperation.decompress:
        return _decompress(input.data);
    }
  }

  /// Compresses UTF-8 text. Convenience for the text-oriented UI path.
  GzipConversionResult compressText(String text, {int? level}) {
    if (text.isEmpty) {
      throw ArgumentError('Input is empty');
    }
    return _compress(Uint8List.fromList(utf8.encode(text)), level);
  }

  /// Compresses arbitrary bytes (e.g. a dropped file).
  GzipConversionResult compressBytes(Uint8List bytes, {int? level}) => _compress(bytes, level);

  /// Decompresses a raw gzip stream.
  GzipConversionResult decompressBytes(Uint8List bytes) => _decompress(bytes);

  /// Decompresses a gzip stream that was pasted in as Base64.
  GzipConversionResult decompressBase64(String text) => _decompress(parseBase64(text));

  /// Turns pasted Base64 into bytes, tolerating wrapped lines, missing
  /// padding and the URL-safe alphabet — all three are common when a
  /// gzipped blob has been through a terminal or a YAML file.
  static Uint8List parseBase64(String text) {
    final cleaned = text.replaceAll(RegExp(r'\s'), '').replaceAll('-', '+').replaceAll('_', '/');
    if (cleaned.isEmpty) {
      throw ArgumentError('Input is empty');
    }
    final padded =
        cleaned.length % 4 == 0 ? cleaned : cleaned.padRight(cleaned.length + (4 - cleaned.length % 4), '=');
    try {
      return base64Decode(padded);
    } on FormatException catch (e) {
      throw FormatException('Invalid Base64 input: ${e.message}');
    }
  }

  /// True when [bytes] starts with the gzip magic number. Used to reject
  /// obviously-wrong input before handing it to the decoder.
  static bool looksLikeGzip(List<int> bytes) =>
      bytes.length >= 2 && bytes[0] == _magic0 && bytes[1] == _magic1;

  GzipConversionResult _compress(Uint8List bytes, int? level) {
    if (bytes.isEmpty) {
      throw ArgumentError('Input is empty');
    }
    if (level != null && (level < 0 || level > 9)) {
      throw ArgumentError('Compression level must be between 0 and 9');
    }

    final Uint8List encoded;
    try {
      encoded = const GZipEncoder().encodeBytes(bytes, level: level);
    } catch (e) {
      throw FormatException('GZip compression failed: $e');
    }

    return GzipConversionResult(
      data: encoded,
      inputSize: bytes.length,
      operation: GzipOperation.compress,
    );
  }

  GzipConversionResult _decompress(Uint8List bytes) {
    if (bytes.isEmpty) {
      throw ArgumentError('Input is empty');
    }
    if (!looksLikeGzip(bytes)) {
      throw const FormatException(
        'Not a GZip stream: the data does not start with the gzip magic number (0x1f 0x8b).',
      );
    }

    final Uint8List decoded;
    try {
      decoded = const GZipDecoder().decodeBytes(bytes, verify: true);
    } catch (e) {
      // Truncated streams, CRC mismatches and corrupt deflate blocks all
      // surface here; none of them should escape as a raw codec error.
      throw FormatException('GZip decompression failed: ${_message(e)}');
    }

    // `verify: true` only checks the header magic bytes and, when the
    // stream is complete, the trailing CRC32/ISIZE — a stream cut off
    // mid-deflate-block (no trailer at all, just missing bytes) decodes
    // "successfully" to a truncated result instead of throwing. The gzip
    // footer's last 4 bytes are ISIZE, the uncompressed size mod 2^32;
    // checking it ourselves catches truncation the decoder's own
    // leniency misses.
    if (bytes.length >= 8) {
      final isize = bytes.buffer.asByteData(bytes.offsetInBytes).getUint32(bytes.length - 4, Endian.little);
      if (decoded.length % 0x100000000 != isize) {
        throw const FormatException(
          'GZip decompression failed: the stream is truncated or corrupt (decoded size does not match the gzip trailer).',
        );
      }
    }

    return GzipConversionResult(
      data: decoded,
      inputSize: bytes.length,
      operation: GzipOperation.decompress,
    );
  }

  String _message(Object error) {
    if (error is FormatException) return error.message;
    if (error is ArgumentError) return '${error.message}';
    return error.toString();
  }
}
