import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/text_diff.dart';

void main() {
  const differ = TextDiff();

  group('LCS behavior', () {
    test('an inserted line shifts nothing else (proves real LCS, not positional diff)', () {
      // A naive positional (index-by-index) comparison would report every
      // line from "b" onward as changed once one line is inserted above them,
      // because it never re-aligns the sequences. A real LCS diff instead
      // recognises "b", "c", "d" as still present unchanged and reports only
      // the inserted line.
      const left = 'a\nb\nc\nd';
      const right = 'a\nX\nb\nc\nd';

      final result = differ.execute(const TextDiffInput(left: left, right: right));

      expect(result.isValid, isTrue);

      // Exactly one added line, the rest unchanged.
      expect(result.summary.added, 1);
      expect(result.summary.removed, 0);
      expect(result.summary.changed, 0);
      expect(result.summary.unchanged, 4);

      // Assert on the actual output shape: 'a' unchanged, 'X' added, then
      // 'b', 'c', 'd' unchanged — none of them re-reported as changed/removed
      // just because their position shifted by one line.
      final kinds = result.lines.map((l) => l.kind).toList();
      final texts = result.lines.map((l) => l.text).toList();
      expect(kinds, [
        DiffLineKind.unchanged,
        DiffLineKind.added,
        DiffLineKind.unchanged,
        DiffLineKind.unchanged,
        DiffLineKind.unchanged,
      ]);
      expect(texts, ['a', 'X', 'b', 'c', 'd']);

      // Line numbers confirm b/c/d kept their identity across the shift:
      // each one's rightLineNumber is one more than its leftLineNumber, but
      // they are still paired as the *same* unchanged line, not new adds.
      final b = result.lines.firstWhere((l) => l.text == 'b');
      expect(b.kind, DiffLineKind.unchanged);
      expect(b.leftLineNumber, 2);
      expect(b.rightLineNumber, 3);

      final d = result.lines.firstWhere((l) => l.text == 'd');
      expect(d.kind, DiffLineKind.unchanged);
      expect(d.leftLineNumber, 4);
      expect(d.rightLineNumber, 5);
    });

    test('a removed line is reported once, surrounding lines stay unchanged', () {
      const left = 'a\nb\nc\nd';
      const right = 'a\nc\nd';

      final result = differ.execute(const TextDiffInput(left: left, right: right));

      expect(result.summary.removed, 1);
      expect(result.summary.added, 0);
      expect(result.summary.changed, 0);
      expect(result.summary.unchanged, 3);

      final kinds = result.lines.map((l) => l.kind).toList();
      final texts = result.lines.map((l) => l.text).toList();
      expect(kinds, [
        DiffLineKind.unchanged,
        DiffLineKind.removed,
        DiffLineKind.unchanged,
        DiffLineKind.unchanged,
      ]);
      expect(texts, ['a', 'b', 'c', 'd']);
    });

    test('a changed line shows as a removed/added pair counted as one changed line', () {
      const left = 'a\nb\nc';
      const right = 'a\nB\nc';

      final result = differ.execute(const TextDiffInput(left: left, right: right));

      expect(result.summary.changed, 1);
      expect(result.summary.added, 0);
      expect(result.summary.removed, 0);
      expect(result.summary.unchanged, 2);

      final kinds = result.lines.map((l) => l.kind).toList();
      expect(kinds, [
        DiffLineKind.unchanged,
        DiffLineKind.removed,
        DiffLineKind.added,
        DiffLineKind.unchanged,
      ]);
    });

    test('identical inputs produce all-unchanged output with zero change counts', () {
      const text = 'one\ntwo\nthree';
      final result = differ.execute(const TextDiffInput(left: text, right: text));

      expect(result.isValid, isTrue);
      expect(result.isIdentical, isTrue);
      expect(result.summary.added, 0);
      expect(result.summary.removed, 0);
      expect(result.summary.changed, 0);
      expect(result.summary.unchanged, 3);
      expect(result.lines, everyElement(predicate<DiffLine>((l) => l.kind == DiffLineKind.unchanged)));
      expect(result.hunks, isEmpty);
    });
  });

  group('options', () {
    test('ignoreWhitespace treats differently-padded lines as equal, display text untouched', () {
      const left = 'a\n  b  \nc';
      const right = 'a\nb\nc';

      final result = differ.execute(const TextDiffInput(left: left, right: right, ignoreWhitespace: true));

      expect(result.isIdentical, isTrue);
      // Display text preserves the original padding on the left side.
      final line = result.lines.firstWhere((l) => l.leftLineNumber == 2);
      expect(line.text, '  b  ');
    });

    test('ignoreCase treats differently-cased lines as equal', () {
      const left = 'Hello\nWorld';
      const right = 'hello\nworld';

      final result = differ.execute(const TextDiffInput(left: left, right: right, ignoreCase: true));

      expect(result.isIdentical, isTrue);
    });

    test('without ignoreCase, case differences are reported as changes', () {
      const left = 'Hello';
      const right = 'hello';

      final result = differ.execute(const TextDiffInput(left: left, right: right));

      expect(result.isIdentical, isFalse);
      expect(result.summary.changed, 1);
    });
  });

  group('JSON mode', () {
    test('reordered keys are treated as identical', () {
      const left = '{"a": 1, "b": 2}';
      const right = '{"b": 2, "a": 1}';

      final result = differ.execute(const TextDiffInput(left: left, right: right, mode: DiffMode.json));

      expect(result.isValid, isTrue);
      expect(result.isIdentical, isTrue);
    });

    test('different values are reported as changed', () {
      const left = '{"a": 1, "b": 2}';
      const right = '{"a": 1, "b": 3}';

      final result = differ.execute(const TextDiffInput(left: left, right: right, mode: DiffMode.json));

      expect(result.isValid, isTrue);
      expect(result.isIdentical, isFalse);
      expect(result.summary.hasDifferences, isTrue);
    });

    test('reformatted whitespace with the same structure is identical', () {
      const left = '{"a":1,"b":[1,2,3]}';
      const right = '''
      {
        "a": 1,
        "b": [1, 2, 3]
      }
      ''';

      final result = differ.execute(const TextDiffInput(left: left, right: right, mode: DiffMode.json));

      expect(result.isValid, isTrue);
      expect(result.isIdentical, isTrue);
    });

    test('list order is preserved and reordered array elements are a real difference', () {
      const left = '[1, 2, 3]';
      const right = '[3, 2, 1]';

      final result = differ.execute(const TextDiffInput(left: left, right: right, mode: DiffMode.json));

      expect(result.isValid, isTrue);
      expect(result.isIdentical, isFalse);
    });

    test('invalid JSON on the left errors cleanly instead of diffing garbage', () {
      const left = '{"a": 1,}';
      const right = '{"a": 1}';

      final result = differ.execute(const TextDiffInput(left: left, right: right, mode: DiffMode.json));

      expect(result.isValid, isFalse);
      expect(result.errorMessage, isNotNull);
      expect(result.errorMessage, contains('Left'));
      expect(result.lines, isEmpty);
    });

    test('invalid JSON on the right errors cleanly and names the right side', () {
      const left = '{"a": 1}';
      const right = 'not json at all';

      final result = differ.execute(const TextDiffInput(left: left, right: right, mode: DiffMode.json));

      expect(result.isValid, isFalse);
      expect(result.errorMessage, isNotNull);
      expect(result.errorMessage, contains('Right'));
    });

    test('an empty side in JSON mode errors cleanly', () {
      final result = differ.execute(const TextDiffInput(left: '', right: '{"a": 1}', mode: DiffMode.json));

      expect(result.isValid, isFalse);
      expect(result.errorMessage, isNotNull);
    });
  });

  group('hunks', () {
    test('no hunks are produced for identical input', () {
      final result = differ.execute(const TextDiffInput(left: 'x\ny', right: 'x\ny'));
      expect(result.hunks, isEmpty);
    });

    test('a hunk groups the changed lines with the header reflecting line ranges', () {
      const left = 'a\nb\nc\nd\ne';
      const right = 'a\nB\nc\nd\ne';

      final result = differ.execute(const TextDiffInput(left: left, right: right, contextLines: 1));

      expect(result.hunks, hasLength(1));
      expect(result.hunks.single.header, startsWith('@@'));
    });
  });
}
