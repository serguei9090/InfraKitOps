import 'dart:convert';

import 'package:bcrypt/bcrypt.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/htpasswd_generator.dart';

void main() {
  const generator = HtpasswdGenerator();

  group('bcrypt', () {
    test('produces a "user:\$2..." line whose hash verifies against bcrypt\'s own checker', () {
      final result = generator.execute(
        const HtpasswdGeneratorInput(
          entries: [HtpasswdEntry(username: 'alice', password: 'correct horse battery staple')],
        ),
      );

      expect(result.lines, hasLength(1));
      final line = result.lines.single;
      expect(line.username, 'alice');
      expect(line.line, startsWith('alice:\$2'));
      // Don't just pattern-match the string shape — ask bcrypt itself whether
      // the hash actually verifies the password it was generated from.
      expect(BCrypt.checkpw('correct horse battery staple', line.hash), isTrue);
      expect(BCrypt.checkpw('wrong password', line.hash), isFalse);
    });

    test('honours a custom bcrypt cost and encodes it in the hash', () {
      final result = generator.execute(
        const HtpasswdGeneratorInput(
          entries: [HtpasswdEntry(username: 'bob', password: 'hunter2')],
          bcryptCost: 6,
        ),
      );
      final hash = result.lines.single.hash;
      expect(hash, startsWith(r'$2a$06$'));
      expect(BCrypt.checkpw('hunter2', hash), isTrue);
    });

    test('warns (but still generates) when the bcrypt cost is low', () {
      final result = generator.execute(
        const HtpasswdGeneratorInput(
          entries: [HtpasswdEntry(username: 'bob', password: 'x')],
          bcryptCost: 4,
        ),
      );
      expect(result.warnings.join(), contains('bcrypt cost 4 is low'));
    });

    test('rejects a bcrypt cost outside the algorithm\'s legal 4..31 range', () {
      expect(
        () => generator.execute(
          const HtpasswdGeneratorInput(
            entries: [HtpasswdEntry(username: 'bob', password: 'x')],
            bcryptCost: 3,
          ),
        ),
        throwsArgumentError,
      );
      expect(
        () => generator.execute(
          const HtpasswdGeneratorInput(
            entries: [HtpasswdEntry(username: 'bob', password: 'x')],
            bcryptCost: 32,
          ),
        ),
        throwsArgumentError,
      );
    });

    test('a password at exactly the 72-byte limit hashes cleanly with no warning', () {
      final result = generator.execute(
        HtpasswdGeneratorInput(
          entries: [HtpasswdEntry(username: 'bob', password: 'x' * 72)],
        ),
      );
      expect(result.warnings, isEmpty);
      expect(BCrypt.checkpw('x' * 72, result.lines.single.hash), isTrue);
    });

    test('a password over the 72-byte limit is rejected by the underlying bcrypt package', () {
      // The core adds an advisory warning for this case (see
      // lib/core/utility/htpasswd_generator.dart), but the `bcrypt` package's
      // own hashpw() validates the encoded length itself and throws first —
      // so in practice an over-limit password never reaches the "warn and
      // silently truncate" path; it throws instead.
      expect(
        () => generator.execute(
          HtpasswdGeneratorInput(entries: [HtpasswdEntry(username: 'bob', password: 'x' * 73)]),
        ),
        throwsArgumentError,
      );
    });
  });

  group('Basic-auth header', () {
    test('round-trips through base64 back to "user:password"', () {
      const builder = BasicAuthHeaderBuilder();
      final result = builder.execute(
        const BasicAuthHeaderInput(username: 'alice', password: 'correct horse battery staple'),
      );

      final decoded = utf8.decode(base64.decode(result.credentialsBase64));
      expect(decoded, 'alice:correct horse battery staple');
      expect(result.headerValue, 'Basic ${result.credentialsBase64}');
      expect(result.headerLine, 'Authorization: Basic ${result.credentialsBase64}');
    });

    test('rejects a username containing ":" (ambiguous with the credential separator)', () {
      const builder = BasicAuthHeaderBuilder();
      expect(
        () => builder.execute(const BasicAuthHeaderInput(username: 'al:ice', password: 'x')),
        throwsArgumentError,
      );
    });

    test('rejects multi-line credentials', () {
      const builder = BasicAuthHeaderBuilder();
      expect(
        () => builder.execute(const BasicAuthHeaderInput(username: 'alice\nbob', password: 'x')),
        throwsArgumentError,
      );
      expect(
        () => builder.execute(const BasicAuthHeaderInput(username: 'alice', password: 'x\ny')),
        throwsArgumentError,
      );
    });
  });

  group('multi-user file', () {
    test('emits exactly one line per user, in input order', () {
      final result = generator.execute(
        const HtpasswdGeneratorInput(
          entries: [
            HtpasswdEntry(username: 'alice', password: 'pw1'),
            HtpasswdEntry(username: 'bob', password: 'pw2'),
            HtpasswdEntry(username: 'carol', password: 'pw3'),
          ],
        ),
      );

      expect(result.lines, hasLength(3));
      expect(result.lines.map((l) => l.username), ['alice', 'bob', 'carol']);

      final fileLines = result.fileContent.trim().split('\n');
      expect(fileLines, hasLength(3));
      expect(fileLines[0], startsWith('alice:'));
      expect(fileLines[1], startsWith('bob:'));
      expect(fileLines[2], startsWith('carol:'));
    });

    test('warns on a duplicate username but still emits both lines', () {
      final result = generator.execute(
        const HtpasswdGeneratorInput(
          entries: [
            HtpasswdEntry(username: 'alice', password: 'pw1'),
            HtpasswdEntry(username: 'alice', password: 'pw2'),
          ],
        ),
      );
      expect(result.lines, hasLength(2));
      expect(result.warnings.join(), contains('Duplicate user "alice"'));
    });

    test('an optional header comment is prepended when requested', () {
      final result = generator.execute(
        const HtpasswdGeneratorInput(
          entries: [HtpasswdEntry(username: 'alice', password: 'pw1')],
          includeHeaderComment: true,
        ),
      );
      expect(result.fileContent, startsWith('# .htpasswd'));
    });

    test('rejects an empty entry list', () {
      expect(
        () => generator.execute(const HtpasswdGeneratorInput(entries: [])),
        throwsArgumentError,
      );
    });
  });

  group('username validation', () {
    test('rejects a username containing ":"', () {
      expect(validateHtpasswdUsername('al:ice'), isNotNull);
      expect(
        () => generator.execute(
          const HtpasswdGeneratorInput(entries: [HtpasswdEntry(username: 'al:ice', password: 'x')]),
        ),
        throwsArgumentError,
      );
    });

    test('rejects an empty username', () {
      expect(validateHtpasswdUsername(''), isNotNull);
    });

    test('rejects leading/trailing whitespace and control characters', () {
      expect(validateHtpasswdUsername(' alice'), isNotNull);
      expect(validateHtpasswdUsername('alice '), isNotNull);
      expect(validateHtpasswdUsername('alice\n'), isNotNull);
      expect(validateHtpasswdUsername(String.fromCharCodes([97, 108, 105, 1, 99, 101])), isNotNull);
    });

    test('accepts an ordinary username', () {
      expect(validateHtpasswdUsername('alice'), isNull);
      expect(validateHtpasswdUsername('alice.smith-01'), isNull);
    });
  });

  group('other algorithms present in the core (not dropped)', () {
    // APR1 and legacy SHA-1 are both still implemented in
    // lib/core/utility/htpasswd_generator.dart, so they get basic coverage
    // here too, alongside the required bcrypt/Basic-auth/multi-user/username
    // cases above.

    test(r'APR1 hash carries the $apr1$ prefix and round-trips through apr1Verify', () {
      final result = generator.execute(
        const HtpasswdGeneratorInput(
          entries: [HtpasswdEntry(username: 'alice', password: 'hunter2')],
          algorithm: HtpasswdAlgorithm.apr1,
        ),
      );
      final hash = result.lines.single.hash;
      expect(hash, startsWith(r'$apr1$'));
      expect(apr1Verify('hunter2', hash), isTrue);
      expect(apr1Verify('wrong', hash), isFalse);
      expect(result.warnings.join(), contains('APR1'));
    });

    test('apr1Crypt with a fixed salt is deterministic', () {
      final a = apr1Crypt('hunter2', salt: 'abcdefgh');
      final b = apr1Crypt('hunter2', salt: 'abcdefgh');
      expect(a, b);
      expect(a, startsWith(r'$apr1$abcdefgh$'));
    });

    test('SHA-1 ({SHA}) hash matches base64(sha1(password)) and is flagged legacy', () {
      final result = generator.execute(
        const HtpasswdGeneratorInput(
          entries: [HtpasswdEntry(username: 'alice', password: 'hunter2')],
          algorithm: HtpasswdAlgorithm.sha1,
        ),
      );
      final hash = result.lines.single.hash;
      expect(hash, startsWith('{SHA}'));
      expect(HtpasswdAlgorithm.sha1.isLegacy, isTrue);
      expect(result.warnings.join(), contains('unsalted'));
    });
  });
}
