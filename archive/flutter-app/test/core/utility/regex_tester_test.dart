import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/regex_tester.dart';

void main() {
  const tester = RegexTester();

  group('matching', () {
    test('finds every match with correct start/end offsets', () {
      final result = tester.execute(
        const RegexTesterInput(pattern: r'\d+', subject: 'a12b345c6'),
      );

      expect(result.isValid, isTrue);
      expect(result.matchCount, 3);

      expect(result.matches[0].text, '12');
      expect(result.matches[0].start, 1);
      expect(result.matches[0].end, 3);

      expect(result.matches[1].text, '345');
      expect(result.matches[1].start, 4);
      expect(result.matches[1].end, 7);

      expect(result.matches[2].text, '6');
      expect(result.matches[2].start, 8);
      expect(result.matches[2].end, 9);

      // Offsets are usable as substring bounds on the original subject.
      for (final match in result.matches) {
        expect('a12b345c6'.substring(match.start, match.end), match.text);
      }
    });

    test('reports zero matches without erroring', () {
      final result = tester.execute(const RegexTesterInput(pattern: r'\d+', subject: 'no digits here'));

      expect(result.isValid, isTrue);
      expect(result.matchCount, 0);
      expect(result.errorMessage, isNull);
      expect(result.explanation, isNotEmpty);
    });
  });

  group('capture groups', () {
    test('reports numbered groups in order', () {
      final result = tester.execute(
        const RegexTesterInput(pattern: r'(\w+)@(\w+)\.com', subject: 'mail ops@example.com now'),
      );

      expect(result.isValid, isTrue);
      expect(result.matchCount, 1);

      final groups = result.matches.single.groups;
      expect(groups, hasLength(2));
      expect(groups[0].index, 1);
      expect(groups[0].value, 'ops');
      expect(groups[0].name, isNull);
      expect(groups[1].index, 2);
      expect(groups[1].value, 'example');
    });

    test('reports named groups with both their name and number', () {
      final result = tester.execute(
        const RegexTesterInput(
          pattern: r'(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})',
          subject: 'released 2024-07-19',
        ),
      );

      expect(result.isValid, isTrue);
      final match = result.matches.single;
      expect(match.text, '2024-07-19');

      final byName = {for (final g in match.namedGroups) g.name: g.value};
      expect(byName, {'year': '2024', 'month': '07', 'day': '19'});

      final year = match.groups.firstWhere((g) => g.name == 'year');
      expect(year.index, 1);
      expect(year.label, '1 (year)');
    });

    test('keeps non-participating groups with a null value', () {
      final result = tester.execute(
        const RegexTesterInput(pattern: r'(a)|(b)', subject: 'a'),
      );

      final groups = result.matches.single.groups;
      expect(groups, hasLength(2));
      expect(groups[0].value, 'a');
      expect(groups[0].didParticipate, isTrue);
      expect(groups[1].value, isNull);
      expect(groups[1].didParticipate, isFalse);
    });
  });

  group('flags', () {
    test('caseInsensitive changes what matches', () {
      const sensitive = RegexTesterInput(pattern: 'hello', subject: 'Hello HELLO hello');
      const insensitive = RegexTesterInput(pattern: 'hello', subject: 'Hello HELLO hello', caseInsensitive: true);

      expect(tester.execute(sensitive).matchCount, 1);
      expect(tester.execute(insensitive).matchCount, 3);
    });

    test('multiLine makes ^ match at each line start', () {
      const subject = 'one\ntwo\nthree';
      const off = RegexTesterInput(pattern: r'^\w+', subject: subject);
      const on = RegexTesterInput(pattern: r'^\w+', subject: subject, multiLine: true);

      expect(tester.execute(off).matchCount, 1);
      expect(tester.execute(on).matchCount, 3);
      expect(tester.execute(on).matches.map((m) => m.text), ['one', 'two', 'three']);
    });

    test('dotAll lets . cross a line break', () {
      const off = RegexTesterInput(pattern: 'a.b', subject: 'a\nb');
      const on = RegexTesterInput(pattern: 'a.b', subject: 'a\nb', dotAll: true);

      expect(tester.execute(off).matchCount, 0);
      expect(tester.execute(on).matchCount, 1);
      expect(tester.execute(on).matches.single.text, 'a\nb');
    });

    test('unicode makes . consume a whole code point', () {
      // U+1F600 is a surrogate pair: two UTF-16 code units, one code point.
      const subject = '\u{1F600}';
      expect(subject.length, 2);

      expect(tester.execute(const RegexTesterInput(pattern: '.', subject: subject)).matchCount, 2);
      expect(
        tester.execute(const RegexTesterInput(pattern: '.', subject: subject, unicode: true)).matchCount,
        1,
      );
    });

    test('flagString reflects the enabled flags', () {
      const input = RegexTesterInput(
        pattern: 'x',
        subject: 'x',
        caseInsensitive: true,
        multiLine: true,
        dotAll: true,
        unicode: true,
      );
      expect(input.flagString, 'gimsu');
      expect(const RegexTesterInput(pattern: 'x', subject: 'x').flagString, 'g');
    });
  });

  group('error handling', () {
    test('an unbalanced group returns an error result instead of throwing', () {
      late RegexTesterResult result;
      expect(() => result = tester.execute(const RegexTesterInput(pattern: '(unclosed', subject: 'abc')), returnsNormally);

      expect(result.isValid, isFalse);
      expect(result.errorMessage, isNotNull);
      expect(result.errorMessage, contains('Invalid pattern'));
      expect(result.matches, isEmpty);
    });

    test('a dangling quantifier returns an error result', () {
      final result = tester.execute(const RegexTesterInput(pattern: '*abc', subject: 'abc'));

      expect(result.isValid, isFalse);
      expect(result.errorMessage, isNotNull);
    });

    test('an empty pattern is reported, not matched', () {
      final result = tester.execute(const RegexTesterInput(pattern: '', subject: 'abc'));

      expect(result.isValid, isFalse);
      expect(result.errorMessage, isNotNull);
    });
  });

  group('safety caps', () {
    test('truncates an over-long subject and says so', () {
      final subject = 'a' * (RegexTester.maxSubjectLength + 500);
      final result = tester.execute(RegexTesterInput(pattern: 'a', subject: subject));

      expect(result.isValid, isTrue);
      expect(result.subjectTruncated, isTrue);
      expect(result.matchCount, RegexTester.maxMatches);
      expect(result.matchesTruncated, isTrue);
      expect(result.warnings, isNotEmpty);
    });

    test('warns about a nested quantifier that risks catastrophic backtracking', () {
      final result = tester.execute(const RegexTesterInput(pattern: r'(a+)+$', subject: 'aaaa!'));

      expect(result.isValid, isTrue);
      expect(result.warnings, contains(RegexTester.nestedQuantifierWarning));
    });

    test('does not warn about an ordinary quantified group', () {
      final result = tester.execute(const RegexTesterInput(pattern: r'(ab)+', subject: 'abab'));

      expect(result.warnings, isNot(contains(RegexTester.nestedQuantifierWarning)));
    });
  });

  group('pattern explainer', () {
    List<String> describe(String pattern) =>
        tester.explain(pattern).map((t) => '${t.token} :: ${t.description}').toList();

    test('names the constructs in a representative pattern', () {
      const pattern = r'^(?<user>[a-z0-9._]+)@(?:mail\.)?example\.com$';
      final tokens = tester.explain(pattern);
      final joined = describe(pattern).join('\n');

      expect(tokens, isNotEmpty);
      expect(joined, contains('Anchor: start of the string'));
      expect(joined, contains('named capturing group "user"'));
      expect(joined, contains('Character class'));
      expect(joined, contains('Repeats the preceding element one or more times'));
      expect(joined, contains('non-capturing group'));
      expect(joined, contains('Makes the preceding element optional'));
      expect(joined, contains('Anchor: end of the string'));

      // Every token is a real slice of the pattern, in order.
      expect(tokens.map((t) => t.token).join(), pattern);
    });

    test('describes shorthand classes, anchors and alternation', () {
      final joined = describe(r'\bcat|dog\b\s\S\W').join('\n');

      expect(joined, contains('Word boundary'));
      expect(joined, contains('Alternation'));
      expect(joined, contains('whitespace'));
      expect(joined, contains('non-whitespace'));
      expect(joined, contains('not a word character'));
    });

    test('describes quantifiers including lazy and braced forms', () {
      final joined = describe(r'a*?b{2,4}c{3}').join('\n');

      expect(joined, contains('zero or more times, lazily'));
      expect(joined, contains('between 2 and 4 times'));
      expect(joined, contains('exactly 3 times'));
    });

    test('describes all four lookaround forms', () {
      final joined = describe(r'(?=a)(?!b)(?<=c)(?<!d)').join('\n');

      expect(joined, contains('Positive lookahead'));
      expect(joined, contains('Negative lookahead'));
      expect(joined, contains('Positive lookbehind'));
      expect(joined, contains('Negative lookbehind'));
    });

    test('splits a literal run so a quantifier attaches to one character', () {
      final tokens = tester.explain('abc+');

      expect(tokens.map((t) => t.token).toList(), ['ab', 'c', '+']);
      expect(tokens[2].description, contains('one or more times'));
    });

    test('tracks nesting depth for indented rendering', () {
      final tokens = tester.explain('((a))');
      final depths = {for (final t in tokens) t.token: t.depth};

      expect(depths['a'], 2);
    });

    test('explains an invalid pattern even though matching fails', () {
      final result = tester.execute(const RegexTesterInput(pattern: r'(\d+', subject: '123'));

      expect(result.isValid, isFalse);
      expect(result.explanation, isNotEmpty);
      expect(result.explanation.map((t) => t.description).join('\n'), contains('capturing group 1'));
    });
  });
}
