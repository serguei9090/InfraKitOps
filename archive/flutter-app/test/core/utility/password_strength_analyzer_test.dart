import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/password_strength_analyzer.dart';

void main() {
  const analyzer = PasswordStrengthAnalyzer();

  test('rates an obviously weak short password as weak', () {
    final result = analyzer.execute(const PasswordStrengthInput(password: 'abc'));
    expect(result.rating, PasswordStrengthRating.weak);
  });

  test('rates an obviously strong long mixed-charset password highly', () {
    final result = analyzer.execute(
      const PasswordStrengthInput(password: r'aB3!xQ9$zP2#Lm7^Rt5&Wc8@'),
    );
    expect(
      result.rating,
      anyOf(PasswordStrengthRating.strong, PasswordStrengthRating.veryStrong),
    );
  });

  test('rating ordering: weak password scores lower than strong password', () {
    final weak = analyzer.execute(const PasswordStrengthInput(password: 'abc'));
    final strong = analyzer.execute(
      const PasswordStrengthInput(password: r'aB3!xQ9$zP2#Lm7^Rt5&Wc8@'),
    );
    expect(weak.entropyBits, lessThan(strong.entropyBits));
    expect(weak.rating.index, lessThan(strong.rating.index));
  });

  test('empty password is weak with zero entropy', () {
    final result = analyzer.execute(const PasswordStrengthInput(password: ''));
    expect(result.entropyBits, 0);
    expect(result.rating, PasswordStrengthRating.weak);
  });

  test('longer passwords of the same charset never score lower', () {
    final shorter = analyzer.execute(const PasswordStrengthInput(password: 'aaaa'));
    final longer = analyzer.execute(const PasswordStrengthInput(password: 'aaaaaaaa'));
    expect(longer.entropyBits, greaterThan(shorter.entropyBits));
  });

  test('adding character classes increases entropy for equal length', () {
    final lowerOnly = analyzer.execute(const PasswordStrengthInput(password: 'abcdefgh'));
    final mixed = analyzer.execute(const PasswordStrengthInput(password: 'aB3defg!'));
    expect(mixed.entropyBits, greaterThan(lowerOnly.entropyBits));
  });
}
