import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/hash_calculator.dart';

/// Looks up the digest with the given [label], failing the test with a
/// helpful message if it's missing.
String digestFor(List<HashDigestResult> digests, String label) {
  final match = digests.where((d) => d.algorithmLabel == label).toList();
  expect(match, hasLength(1), reason: 'expected exactly one "$label" digest');
  return match.single.hex;
}

void main() {
  const calculator = HashCalculator();

  group('published known-answer test vectors', () {
    test('MD5 of the empty string', () {
      final result = calculator.execute(const HashCalculatorInput(text: ''));
      expect(digestFor(result.digests, 'MD5'), 'd41d8cd98f00b204e9800998ecf8427e');
    });

    test('MD5 of "abc"', () {
      final result = calculator.execute(const HashCalculatorInput(text: 'abc'));
      expect(digestFor(result.digests, 'MD5'), '900150983cd24fb0d6963f7d28e17f72');
    });

    test('SHA-256 of the empty string', () {
      final result = calculator.execute(const HashCalculatorInput(text: ''));
      expect(
        digestFor(result.digests, 'SHA-256'),
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );
    });

    test('SHA-256 of "abc"', () {
      final result = calculator.execute(const HashCalculatorInput(text: 'abc'));
      expect(
        digestFor(result.digests, 'SHA-256'),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    test('SHA-1 of "abc"', () {
      final result = calculator.execute(const HashCalculatorInput(text: 'abc'));
      expect(digestFor(result.digests, 'SHA-1'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
    });

    test('SHA-512 of "abc"', () {
      final result = calculator.execute(const HashCalculatorInput(text: 'abc'));
      expect(
        digestFor(result.digests, 'SHA-512'),
        'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a'
        '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
      );
    });

    test('HMAC-MD5 with key "key" and message "The quick brown fox jumps over the lazy dog" (RFC 2202)', () {
      final result = calculator.execute(
        const HashCalculatorInput(
          text: 'The quick brown fox jumps over the lazy dog',
          hmacSecretKey: 'key',
        ),
      );
      expect(digestFor(result.hmacDigests, 'HMAC-MD5'), '80070713463e7749b90c2dc24911e275');
    });

    test('HMAC-SHA-256 with key "key" and message "The quick brown fox jumps over the lazy dog"', () {
      final result = calculator.execute(
        const HashCalculatorInput(
          text: 'The quick brown fox jumps over the lazy dog',
          hmacSecretKey: 'key',
        ),
      );
      expect(
        digestFor(result.hmacDigests, 'HMAC-SHA-256'),
        'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
      );
    });
  });

  group('BLAKE2b-512', () {
    test('is deterministic and produces a 128 hex-char (512-bit) digest', () {
      final result = calculator.execute(const HashCalculatorInput(text: 'abc'));
      final digest = digestFor(result.digests, 'BLAKE2b-512');
      expect(digest, hasLength(128));
      expect(digest, matches(RegExp(r'^[0-9a-f]+$')));

      final second = calculator.execute(const HashCalculatorInput(text: 'abc'));
      expect(digestFor(second.digests, 'BLAKE2b-512'), digest);
    });

    test('differs for different inputs', () {
      final a = calculator.execute(const HashCalculatorInput(text: 'abc'));
      final b = calculator.execute(const HashCalculatorInput(text: 'abd'));
      expect(digestFor(a.digests, 'BLAKE2b-512'), isNot(digestFor(b.digests, 'BLAKE2b-512')));
    });
  });

  group('general behavior', () {
    test('always returns exactly 5 plain digests in a stable order', () {
      final result = calculator.execute(const HashCalculatorInput(text: 'hello'));
      expect(
        result.digests.map((d) => d.algorithmLabel).toList(),
        ['MD5', 'SHA-1', 'SHA-256', 'SHA-512', 'BLAKE2b-512'],
      );
    });

    test('omits HMAC digests when no secret key is given', () {
      final result = calculator.execute(const HashCalculatorInput(text: 'hello'));
      expect(result.hmacDigests, isEmpty);
    });

    test('omits HMAC digests when the secret key is empty', () {
      final result = calculator.execute(const HashCalculatorInput(text: 'hello', hmacSecretKey: ''));
      expect(result.hmacDigests, isEmpty);
    });

    test('produces 4 HMAC digests (MD5/SHA-1/SHA-256/SHA-512) when a secret key is given', () {
      final result = calculator.execute(const HashCalculatorInput(text: 'hello', hmacSecretKey: 'secret'));
      expect(
        result.hmacDigests.map((d) => d.algorithmLabel).toList(),
        ['HMAC-MD5', 'HMAC-SHA-1', 'HMAC-SHA-256', 'HMAC-SHA-512'],
      );
    });

    test('different secret keys change the HMAC output', () {
      final a = calculator.execute(const HashCalculatorInput(text: 'hello', hmacSecretKey: 'key-a'));
      final b = calculator.execute(const HashCalculatorInput(text: 'hello', hmacSecretKey: 'key-b'));
      expect(digestFor(a.hmacDigests, 'HMAC-SHA-256'), isNot(digestFor(b.hmacDigests, 'HMAC-SHA-256')));
    });
  });
}
