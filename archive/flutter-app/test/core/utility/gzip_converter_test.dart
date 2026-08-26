import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/gzip_converter.dart';

void main() {
  const converter = GzipConverter();

  group('compress / decompress round trip', () {
    test('text survives a gzip round trip unchanged', () {
      const original = 'InfraKit Studio — gzip round trip with ünïcode ✓\nline two\n';

      final compressed = converter.compressText(original);
      final restored = converter.decompressBytes(compressed.data);

      expect(restored.textOrNull, original);
      expect(restored.originalSize, utf8.encode(original).length);
    });

    test('arbitrary binary bytes survive a round trip unchanged', () {
      final bytes = Uint8List.fromList([for (var i = 0; i < 512; i++) (i * 37) % 256]);

      final compressed = converter.compressBytes(bytes);
      final restored = converter.decompressBytes(compressed.data);

      expect(restored.data, bytes);
    });

    test('gzip output starts with the gzip magic number', () {
      final compressed = converter.compressText('hello');
      expect(GzipConverter.looksLikeGzip(compressed.data), isTrue);
      expect(compressed.data[0], 0x1f);
      expect(compressed.data[1], 0x8b);
    });
  });

  group('size reporting', () {
    test('a highly repetitive string compresses to a fraction of its size', () {
      final repetitive = 'the same line over and over\n' * 400;

      final result = converter.compressText(repetitive);

      expect(result.originalSize, utf8.encode(repetitive).length);
      expect(result.compressedSize, lessThan(result.originalSize ~/ 10));
      expect(result.compressionRatio, lessThan(0.1));
      expect(result.spaceSavingPercent, greaterThan(90));
    });

    test('sizes are reported from the payload side regardless of direction', () {
      final compressed = converter.compressText('a' * 1000);
      final restored = converter.decompressBytes(compressed.data);

      expect(restored.originalSize, 1000);
      expect(restored.compressedSize, compressed.compressedSize);
      expect(restored.compressionRatio, closeTo(compressed.compressionRatio, 1e-9));
    });
  });

  group('base64 transport', () {
    test('text -> gzip -> base64 -> gzip -> text round trips', () {
      const original = 'kubectl get pods -A | grep CrashLoopBackOff';

      final compressed = converter.compressText(original);
      final restored = converter.decompressBase64(compressed.base64);

      expect(restored.textOrNull, original);
    });

    test('base64 pasted with line breaks and no padding still decodes', () {
      final compressed = converter.compressText('wrapped payload ' * 20);

      final wrapped = _wrap(compressed.base64, 40);
      final unpadded = wrapped.replaceAll('=', '');

      expect(converter.decompressBase64(wrapped).textOrNull, 'wrapped payload ' * 20);
      expect(converter.decompressBase64(unpadded).textOrNull, 'wrapped payload ' * 20);
    });

    test('url-safe base64 alphabet is accepted', () {
      final compressed = converter.compressText('url safe alphabet test payload');
      final urlSafe = compressed.base64.replaceAll('+', '-').replaceAll('/', '_');

      expect(converter.decompressBase64(urlSafe).textOrNull, 'url safe alphabet test payload');
    });
  });

  group('error handling', () {
    test('decompressing non-gzip bytes throws a clean FormatException', () {
      expect(
        () => converter.decompressBytes(Uint8List.fromList(utf8.encode('this is just text'))),
        throwsA(
          isA<FormatException>().having((e) => e.message, 'message', contains('Not a GZip stream')),
        ),
      );
    });

    test('decompressing a truncated gzip stream throws a clean FormatException', () {
      final compressed = converter.compressText('truncate me ' * 100);
      final truncated = Uint8List.sublistView(compressed.data, 0, compressed.data.length ~/ 2);

      expect(
        () => converter.decompressBytes(truncated),
        throwsA(
          isA<FormatException>()
              .having((e) => e.message, 'message', contains('GZip decompression failed')),
        ),
      );
    });

    test('decompressing garbage base64 throws a clean FormatException', () {
      expect(
        () => converter.decompressBase64('not valid base64 @@@@'),
        throwsA(isA<FormatException>()),
      );
    });

    test('empty input is rejected on both sides', () {
      expect(() => converter.compressText(''), throwsA(isA<ArgumentError>()));
      expect(() => converter.compressBytes(Uint8List(0)), throwsA(isA<ArgumentError>()));
      expect(() => converter.decompressBytes(Uint8List(0)), throwsA(isA<ArgumentError>()));
      expect(() => converter.decompressBase64('   '), throwsA(isA<ArgumentError>()));
    });

    test('an out-of-range compression level is rejected', () {
      expect(
        () => converter.compressBytes(Uint8List.fromList([1, 2, 3]), level: 12),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('decompressed binary that is not UTF-8 yields null text instead of throwing', () {
      final bytes = Uint8List.fromList([0xFF, 0xFE, 0x00, 0x80, 0xC0]);
      final restored = converter.decompressBytes(converter.compressBytes(bytes).data);

      expect(restored.data, bytes);
      expect(restored.textOrNull, isNull);
    });
  });

  group('execute() port', () {
    test('routes through the IToolUseCase entry point', () {
      final source = Uint8List.fromList(utf8.encode('port test'));

      final compressed = converter.execute(
        GzipConversionInput(data: source, operation: GzipOperation.compress),
      );
      final restored = converter.execute(
        GzipConversionInput(data: compressed.data, operation: GzipOperation.decompress),
      );

      expect(restored.data, source);
    });
  });
}

String _wrap(String text, int width) {
  final buffer = StringBuffer();
  for (var i = 0; i < text.length; i += width) {
    if (i > 0) buffer.write('\n');
    buffer.write(text.substring(i, i + width > text.length ? text.length : i + width));
  }
  return buffer.toString();
}
