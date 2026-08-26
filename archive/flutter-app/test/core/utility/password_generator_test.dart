import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/password_generator.dart';

void main() {
  group('PasswordGenerator', () {
    const generator = PasswordGenerator();

    test('produces a password of the requested length', () {
      final result = generator.execute(const PasswordGeneratorInput(length: 24));
      expect(result.password.length, 24);
    });

    test('only uses digits when only digits are enabled', () {
      final result = generator.execute(
        const PasswordGeneratorInput(
          length: 32,
          includeUppercase: false,
          includeLowercase: false,
          includeDigits: true,
          includeSymbols: false,
        ),
      );
      expect(result.password, matches(RegExp(r'^[0-9]+$')));
    });

    test('only uses lowercase letters when only lowercase is enabled', () {
      final result = generator.execute(
        const PasswordGeneratorInput(
          length: 32,
          includeUppercase: false,
          includeLowercase: true,
          includeDigits: false,
          includeSymbols: false,
        ),
      );
      expect(result.password, matches(RegExp(r'^[a-z]+$')));
    });

    test('generates distinct passwords across calls', () {
      final a = generator.execute(const PasswordGeneratorInput(length: 20));
      final b = generator.execute(const PasswordGeneratorInput(length: 20));
      expect(a.password, isNot(equals(b.password)));
    });

    test('throws when length is not positive', () {
      expect(
        () => generator.execute(const PasswordGeneratorInput(length: 0)),
        throwsArgumentError,
      );
    });

    test('throws when no character set is enabled', () {
      expect(
        () => generator.execute(
          const PasswordGeneratorInput(
            length: 10,
            includeUppercase: false,
            includeLowercase: false,
            includeDigits: false,
            includeSymbols: false,
          ),
        ),
        throwsArgumentError,
      );
    });
  });

  group('PassphraseGenerator', () {
    const generator = PassphraseGenerator();

    test('produces the requested number of words joined by the separator', () {
      final result = generator.execute(
        const PassphraseGeneratorInput(wordCount: 5, separator: '-'),
      );
      final segments = result.passphrase.split('-');
      expect(segments, hasLength(5));
      for (final segment in segments) {
        expect(passphraseWordList, contains(segment));
      }
    });

    test('capitalizes words when requested', () {
      final result = generator.execute(
        const PassphraseGeneratorInput(
          wordCount: 4,
          separator: '-',
          capitalizeWords: true,
        ),
      );
      for (final segment in result.passphrase.split('-')) {
        expect(segment[0], segment[0].toUpperCase());
      }
    });

    test('appends a numeric segment when includeNumber is true', () {
      final result = generator.execute(
        const PassphraseGeneratorInput(
          wordCount: 3,
          separator: '-',
          includeNumber: true,
        ),
      );
      final segments = result.passphrase.split('-');
      expect(segments, hasLength(4));
      expect(int.tryParse(segments.last), isNotNull);
    });

    test('respects a custom separator', () {
      final result = generator.execute(
        const PassphraseGeneratorInput(wordCount: 3, separator: '_'),
      );
      expect(result.passphrase.split('_'), hasLength(3));
      expect(result.passphrase, isNot(contains('-')));
    });

    test('throws when wordCount is not positive', () {
      expect(
        () => generator.execute(const PassphraseGeneratorInput(wordCount: 0)),
        throwsArgumentError,
      );
    });

    test('word list has a few hundred unique words', () {
      expect(passphraseWordList.length, greaterThanOrEqualTo(200));
      expect(passphraseWordList.toSet().length, passphraseWordList.length);
    });
  });
}
