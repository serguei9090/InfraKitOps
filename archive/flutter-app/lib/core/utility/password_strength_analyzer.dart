import 'dart:math' as math;

import '../ports/i_tool_use_case.dart';

/// Qualitative strength rating, ordered weakest to strongest.
enum PasswordStrengthRating { weak, fair, strong, veryStrong }

class PasswordStrengthInput {
  const PasswordStrengthInput({required this.password});

  final String password;
}

class PasswordStrengthResult {
  const PasswordStrengthResult({
    required this.entropyBits,
    required this.rating,
  });

  /// Estimated entropy in bits: length * log2(character-set size).
  final double entropyBits;

  final PasswordStrengthRating rating;
}

/// Estimates password strength with a simple, defensible heuristic:
/// entropy bits = length * log2(character-set size), where the
/// character-set size is the sum of the classes (lowercase/uppercase/
/// digits/symbols) actually present in the password.
///
/// This is intentionally not zxcvbn-grade -- it does not detect dictionary
/// words, keyboard patterns, or repetition -- but it gives a reasonable
/// order-of-magnitude estimate suitable for a UI strength meter.
class PasswordStrengthAnalyzer
    implements IToolUseCase<PasswordStrengthInput, PasswordStrengthResult> {
  const PasswordStrengthAnalyzer();

  static const int lowercasePoolSize = 26;
  static const int uppercasePoolSize = 26;
  static const int digitPoolSize = 10;
  // Common symbol pool as used on standard keyboards: !"#$%&'()*+,-./:;<=>?@
  // [\]^_`{|}~ plus space -- 33 characters is a widely used estimate.
  static const int symbolPoolSize = 33;

  static final RegExp _lowercasePattern = RegExp(r'[a-z]');
  static final RegExp _uppercasePattern = RegExp(r'[A-Z]');
  static final RegExp _digitPattern = RegExp(r'[0-9]');
  static final RegExp _symbolPattern = RegExp(r'[^a-zA-Z0-9]');

  @override
  PasswordStrengthResult execute(PasswordStrengthInput input) {
    final password = input.password;
    if (password.isEmpty) {
      return const PasswordStrengthResult(
        entropyBits: 0,
        rating: PasswordStrengthRating.weak,
      );
    }

    var poolSize = 0;
    if (_lowercasePattern.hasMatch(password)) poolSize += lowercasePoolSize;
    if (_uppercasePattern.hasMatch(password)) poolSize += uppercasePoolSize;
    if (_digitPattern.hasMatch(password)) poolSize += digitPoolSize;
    if (_symbolPattern.hasMatch(password)) poolSize += symbolPoolSize;
    if (poolSize == 0) poolSize = 1;

    final entropyBits = password.length * (math.log(poolSize) / math.log(2));

    return PasswordStrengthResult(
      entropyBits: entropyBits,
      rating: _rate(entropyBits),
    );
  }

  PasswordStrengthRating _rate(double entropyBits) {
    if (entropyBits < 28) return PasswordStrengthRating.weak;
    if (entropyBits < 36) return PasswordStrengthRating.fair;
    if (entropyBits < 60) return PasswordStrengthRating.strong;
    return PasswordStrengthRating.veryStrong;
  }
}
