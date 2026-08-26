import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/bcrypt_tool.dart';

void main() {
  const hasher = BcryptHasher();
  const verifier = BcryptVerifier();

  group('BcryptHasher', () {
    test('produces a well-formed bcrypt hash string', () {
      final result = hasher.execute(const BcryptHashInput(plaintext: 'hunter2', logRounds: 4));
      // $<version>$<cost>$<22-char salt><31-char digest>
      expect(result.hash, matches(RegExp(r'^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$')));
      expect(result.hash, startsWith(r'$2a$04$'));
    });

    test('generates a different hash each time for the same plaintext (random salt)', () {
      final a = hasher.execute(const BcryptHashInput(plaintext: 'hunter2', logRounds: 4));
      final b = hasher.execute(const BcryptHashInput(plaintext: 'hunter2', logRounds: 4));
      expect(a.hash, isNot(b.hash));
    });

    test('rejects out-of-range log-rounds', () {
      expect(
        () => hasher.execute(const BcryptHashInput(plaintext: 'hunter2', logRounds: 1)),
        throwsArgumentError,
      );
      expect(
        () => hasher.execute(const BcryptHashInput(plaintext: 'hunter2', logRounds: 99)),
        throwsArgumentError,
      );
    });
  });

  group('BcryptVerifier', () {
    test('accepts the correct plaintext against a freshly generated hash', () {
      final hash = hasher.execute(const BcryptHashInput(plaintext: 'correct horse battery staple', logRounds: 4));
      final result = verifier.execute(
        BcryptVerifyInput(plaintext: 'correct horse battery staple', hash: hash.hash),
      );
      expect(result.matches, isTrue);
    });

    test('rejects the wrong plaintext against a valid hash', () {
      final hash = hasher.execute(const BcryptHashInput(plaintext: 'correct horse battery staple', logRounds: 4));
      final result = verifier.execute(
        BcryptVerifyInput(plaintext: 'wrong password', hash: hash.hash),
      );
      expect(result.matches, isFalse);
    });

    test('verifies against a pre-recorded fixture hash (fixed-salt regression vector)', () {
      // bcrypt embeds a random salt in every hash, so there is no
      // cross-implementation "hash of 'abc'" constant the way there is for
      // MD5/SHA-256. Instead this fixture was generated once with the
      // `bcrypt` package itself using a deterministic (seeded, non-secure)
      // PRNG for the salt, then frozen here so the verifier's decoding of an
      // externally-produced hash string is exercised, not just a live
      // hash-then-immediately-verify round trip against fresh output.
      const fixtureHash = r'$2a$04$y4tiGeWwdpFlQhdt/zqxf.ZbJzRxB2WjyEZXYjWxuSEEsplrY8JQ2';

      final correct = verifier.execute(
        const BcryptVerifyInput(plaintext: 'correct horse battery staple', hash: fixtureHash),
      );
      expect(correct.matches, isTrue);

      final wrong = verifier.execute(
        const BcryptVerifyInput(plaintext: 'wrong password', hash: fixtureHash),
      );
      expect(wrong.matches, isFalse);
    });

    test('returns false (not a thrown error) for a malformed hash string', () {
      final result = verifier.execute(
        const BcryptVerifyInput(plaintext: 'hunter2', hash: 'not-a-bcrypt-hash'),
      );
      expect(result.matches, isFalse);
    });
  });
}
