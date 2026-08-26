import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/base64_file_converter.dart';

void main() {
  const encoder = Base64FileEncoder();
  const decoder = Base64FileDecoder();

  group('bytes -> base64 -> bytes round trip', () {
    test('genuinely binary bytes survive a round trip unchanged', () {
      final bytes = Uint8List.fromList([
        0, 1, 2, 255, 254, 128, 127, 16, 32, 64, 200, 201, 202, 3, 9, 250,
        for (var i = 0; i < 256; i++) i,
      ]);

      final encoded = encoder.execute(Base64FileEncodeInput(bytes: bytes));
      final decoded = decoder.execute(Base64FileDecodeInput(text: encoded.base64));

      expect(decoded.bytes, bytes);
      expect(decoded.byteSize, bytes.length);
    });

    test('all 256 byte values round trip exactly', () {
      final bytes = Uint8List.fromList(List<int>.generate(256, (i) => i));

      final encoded = encoder.execute(Base64FileEncodeInput(bytes: bytes));
      final decoded = decoder.execute(Base64FileDecodeInput(text: encoded.base64));

      expect(decoded.bytes, bytes);
    });

    test('encodedLength reflects the bare base64 payload length', () {
      final bytes = Uint8List.fromList([0, 1, 2, 3, 4, 5, 6, 7]);
      final encoded = encoder.execute(Base64FileEncodeInput(bytes: bytes));

      expect(encoded.encodedLength, encoded.base64.length);
      expect(encoded.byteSize, bytes.length);
    });

    test('plain wrapping with a line length wraps but still decodes back to the same bytes', () {
      final bytes = Uint8List.fromList(List<int>.generate(200, (i) => (i * 53) % 256));

      final encoded = encoder.execute(
        Base64FileEncodeInput(bytes: bytes, wrapping: Base64Wrapping.plain, lineLength: 16),
      );

      expect(encoded.output.split('\n').length, greaterThan(1));
      expect(encoded.output.split('\n').first.length, 16);

      final decoded = decoder.execute(Base64FileDecodeInput(text: encoded.output));
      expect(decoded.bytes, bytes);
    });
  });

  group('data URI form', () {
    test('encodes as a data URI and decodes back to the original bytes with mime type recovered', () {
      final bytes = Uint8List.fromList([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);

      final encoded = encoder.execute(
        Base64FileEncodeInput(bytes: bytes, wrapping: Base64Wrapping.dataUri, mimeType: 'image/png'),
      );

      expect(encoded.output, startsWith('data:image/png;base64,'));

      final decoded = decoder.execute(Base64FileDecodeInput(text: encoded.output));
      expect(decoded.bytes, bytes);
      expect(decoded.mimeType, 'image/png');
    });

    test('defaults to application/octet-stream when no mime type is given', () {
      final bytes = Uint8List.fromList([9, 9, 9]);
      final encoded = encoder.execute(Base64FileEncodeInput(bytes: bytes, wrapping: Base64Wrapping.dataUri));

      expect(encoded.output, startsWith('data:application/octet-stream;base64,'));
    });

    test('data URI with parameters (e.g. charset) still parses back correctly', () {
      final match = RegExp(r'^data:([^;,]*)((?:;[^;,]*)*);base64,').firstMatch(
        'data:text/plain;charset=utf-8;base64,${base64Encode(utf8.encode('hi'))}',
      );
      expect(match, isNotNull);

      final decoded = decoder.execute(
        Base64FileDecodeInput(text: 'data:text/plain;charset=utf-8;base64,${base64Encode(utf8.encode('hi'))}'),
      );
      expect(utf8.decode(decoded.bytes), 'hi');
      expect(decoded.mimeType, 'text/plain');
    });

    test('a data: prefix without a base64 marker errors cleanly', () {
      expect(
        () => decoder.execute(const Base64FileDecodeInput(text: 'data:text/plain,hello')),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('kubernetes secret wrapping', () {
    test('produces a single-line base64 value inside a v1/Secret manifest', () {
      final bytes = Uint8List.fromList(utf8.encode('super secret value'));
      final encoded = encoder.execute(
        Base64FileEncodeInput(
          bytes: bytes,
          wrapping: Base64Wrapping.k8sSecret,
          secretName: 'my-secret',
          secretKey: 'file',
        ),
      );

      expect(encoded.output, contains('kind: Secret'));
      expect(encoded.output, contains('name: my-secret'));
      expect(encoded.output, contains('file: ${encoded.base64}'));
      // The data: value itself must stay single-line.
      final dataLine = encoded.output.split('\n').firstWhere((l) => l.trim().startsWith('file:'));
      expect(dataLine.contains('\n'), isFalse);
    });
  });

  group('tolerant parsing', () {
    test('base64 wrapped with newlines and no padding still decodes', () {
      const original = 'wrap me please, this is a longer payload for wrapping';
      final encoded = base64Encode(utf8.encode(original));
      final wrapped = [for (var i = 0; i < encoded.length; i += 8) encoded.substring(i, (i + 8).clamp(0, encoded.length))]
          .join('\n')
          .replaceAll('=', '');

      final decoded = decoder.execute(Base64FileDecodeInput(text: wrapped));
      expect(utf8.decode(decoded.bytes), original);
    });

    test('url-safe alphabet is accepted', () {
      final bytes = Uint8List.fromList([255, 239, 190, 0, 1]);
      final encoded = encoder.execute(Base64FileEncodeInput(bytes: bytes));
      final urlSafe = encoded.base64.replaceAll('+', '-').replaceAll('/', '_');

      final decoded = decoder.execute(Base64FileDecodeInput(text: urlSafe));
      expect(decoded.bytes, bytes);
    });
  });

  group('error handling', () {
    test('encoding empty bytes is rejected', () {
      expect(
        () => encoder.execute(Base64FileEncodeInput(bytes: Uint8List(0))),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('a line length below 4 is rejected', () {
      expect(
        () => encoder.execute(
          Base64FileEncodeInput(bytes: Uint8List.fromList([1, 2, 3]), lineLength: 2),
        ),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('decoding empty text is rejected', () {
      expect(
        () => decoder.execute(const Base64FileDecodeInput(text: '   ')),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('invalid base64 characters throw a clean FormatException', () {
      expect(
        () => decoder.execute(const Base64FileDecodeInput(text: '@@@not valid base64@@@')),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('mime/extension helpers', () {
    test('guesses mime types from common extensions', () {
      expect(guessMimeType('photo.png'), 'image/png');
      expect(guessMimeType('archive.tar'), 'application/x-tar');
      expect(guessMimeType('unknownfile'), 'application/octet-stream');
      expect(guessMimeType('trailing.'), 'application/octet-stream');
    });

    test('resolves an extension back from a mime type', () {
      expect(extensionForMimeType('image/png'), 'png');
      expect(extensionForMimeType('application/json'), 'json');
      expect(extensionForMimeType(null), 'bin');
      expect(extensionForMimeType('application/x-made-up'), 'bin');
    });
  });
}
