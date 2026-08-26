import 'dart:convert';

import 'package:crypto/crypto.dart' as crypto;
import 'package:hashlib/hashlib.dart' as hashlib;

import '../ports/i_tool_use_case.dart';

/// One computed digest, paired with a human-readable label for display.
class HashDigestResult {
  const HashDigestResult({required this.algorithmLabel, required this.hex});

  /// e.g. "MD5", "SHA-256", "HMAC-SHA-512".
  final String algorithmLabel;

  /// Lowercase hexadecimal digest.
  final String hex;
}

class HashCalculatorInput {
  const HashCalculatorInput({required this.text, this.hmacSecretKey});

  /// The plaintext (UTF-8 encoded) to hash.
  final String text;

  /// Optional secret key. When non-null and non-empty, HMAC variants of the
  /// crypto-package-backed algorithms (MD5, SHA-1, SHA-256, SHA-512) are also
  /// computed. BLAKE2b is not included in HMAC output since it is produced
  /// via the `hashlib` package rather than `crypto`'s [crypto.Hmac].
  final String? hmacSecretKey;
}

class HashCalculatorResult {
  const HashCalculatorResult({required this.digests, required this.hmacDigests});

  /// Plain (unkeyed) digests: MD5, SHA-1, SHA-256, SHA-512, BLAKE2b-512.
  final List<HashDigestResult> digests;

  /// HMAC digests keyed by [HashCalculatorInput.hmacSecretKey]. Empty when no
  /// secret key was supplied.
  final List<HashDigestResult> hmacDigests;
}

/// Computes MD5 / SHA-1 / SHA-256 / SHA-512 (via the `crypto` package) and
/// BLAKE2b-512 (via the `hashlib` package) digests for a text input, plus the
/// HMAC variant of each `crypto`-backed algorithm when a secret key is given.
///
/// Pure Dart, zero I/O, zero Flutter — lives in the core so it is
/// unit-testable in milliseconds and reusable by any UI adapter.
class HashCalculator implements IToolUseCase<HashCalculatorInput, HashCalculatorResult> {
  const HashCalculator();

  @override
  HashCalculatorResult execute(HashCalculatorInput input) {
    final bytes = utf8.encode(input.text);

    final digests = <HashDigestResult>[
      HashDigestResult(algorithmLabel: 'MD5', hex: crypto.md5.convert(bytes).toString()),
      HashDigestResult(algorithmLabel: 'SHA-1', hex: crypto.sha1.convert(bytes).toString()),
      HashDigestResult(algorithmLabel: 'SHA-256', hex: crypto.sha256.convert(bytes).toString()),
      HashDigestResult(algorithmLabel: 'SHA-512', hex: crypto.sha512.convert(bytes).toString()),
      HashDigestResult(algorithmLabel: 'BLAKE2b-512', hex: hashlib.blake2b512.convert(bytes).hex()),
    ];

    final secret = input.hmacSecretKey;
    final hmacDigests = <HashDigestResult>[];
    if (secret != null && secret.isNotEmpty) {
      final keyBytes = utf8.encode(secret);
      hmacDigests.addAll([
        HashDigestResult(
          algorithmLabel: 'HMAC-MD5',
          hex: crypto.Hmac(crypto.md5, keyBytes).convert(bytes).toString(),
        ),
        HashDigestResult(
          algorithmLabel: 'HMAC-SHA-1',
          hex: crypto.Hmac(crypto.sha1, keyBytes).convert(bytes).toString(),
        ),
        HashDigestResult(
          algorithmLabel: 'HMAC-SHA-256',
          hex: crypto.Hmac(crypto.sha256, keyBytes).convert(bytes).toString(),
        ),
        HashDigestResult(
          algorithmLabel: 'HMAC-SHA-512',
          hex: crypto.Hmac(crypto.sha512, keyBytes).convert(bytes).toString(),
        ),
      ]);
    }

    return HashCalculatorResult(digests: digests, hmacDigests: hmacDigests);
  }
}
