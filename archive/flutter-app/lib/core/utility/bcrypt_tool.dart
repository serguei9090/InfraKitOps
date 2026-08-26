import 'package:bcrypt/bcrypt.dart';

import '../ports/i_tool_use_case.dart';

/// bcrypt's log2 cost factor range, per the algorithm's own spec (also
/// enforced by [BCrypt.gensalt]).
const int kBcryptMinLogRounds = 4;
const int kBcryptMaxLogRounds = 31;
const int kBcryptDefaultLogRounds = 10;

class BcryptHashInput {
  const BcryptHashInput({required this.plaintext, this.logRounds = kBcryptDefaultLogRounds});

  final String plaintext;

  /// Log2 number of hashing rounds (cost factor). Higher is slower/safer.
  final int logRounds;
}

class BcryptHashResult {
  const BcryptHashResult({required this.hash});

  /// The full bcrypt-encoded hash string (prefix + cost + salt + digest),
  /// e.g. `$2a$10$....`.
  final String hash;
}

/// Generates a salted bcrypt hash for a plaintext password/secret.
///
/// bcrypt is one-way and self-salting: unlike MD5/SHA/BLAKE2b it never
/// produces a stable digest for a given input (a fresh random salt is drawn
/// every call), and it can't be "checked" by recomputing and comparing hex
/// strings directly — hence it gets its own use case rather than being
/// lumped into [HashCalculator].
class BcryptHasher implements IToolUseCase<BcryptHashInput, BcryptHashResult> {
  const BcryptHasher();

  @override
  BcryptHashResult execute(BcryptHashInput input) {
    if (input.logRounds < kBcryptMinLogRounds || input.logRounds > kBcryptMaxLogRounds) {
      throw ArgumentError.value(
        input.logRounds,
        'logRounds',
        'Must be between $kBcryptMinLogRounds and $kBcryptMaxLogRounds',
      );
    }
    final salt = BCrypt.gensalt(logRounds: input.logRounds);
    return BcryptHashResult(hash: BCrypt.hashpw(input.plaintext, salt));
  }
}

class BcryptVerifyInput {
  const BcryptVerifyInput({required this.plaintext, required this.hash});

  final String plaintext;

  /// A previously generated bcrypt hash string to check against.
  final String hash;
}

class BcryptVerifyResult {
  const BcryptVerifyResult({required this.matches});

  final bool matches;
}

/// Verifies a plaintext against a previously generated bcrypt hash by
/// recomputing bcrypt with the salt embedded in that hash and comparing.
class BcryptVerifier implements IToolUseCase<BcryptVerifyInput, BcryptVerifyResult> {
  const BcryptVerifier();

  @override
  BcryptVerifyResult execute(BcryptVerifyInput input) {
    try {
      return BcryptVerifyResult(matches: BCrypt.checkpw(input.plaintext, input.hash));
    } on FormatException {
      return const BcryptVerifyResult(matches: false);
    } on ArgumentError {
      return const BcryptVerifyResult(matches: false);
    }
  }
}
