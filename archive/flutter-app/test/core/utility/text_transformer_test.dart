import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/text_transformer.dart';

void main() {
  const transformer = TextTransformer();

  group('case conversion — from an already-differently-cased source', () {
    // Source is camelCase/PascalCase with an acronym, deliberately NOT the
    // target case, so a naive boundary detector (e.g. one that just splits
    // on every uppercase letter) would shred the acronym.
    const source = 'XMLHttpRequest';

    test('camelCase', () {
      expect(transformer.convertCase(source, TextCase.camel).output, 'xmlHttpRequest');
    });

    test('PascalCase', () {
      expect(transformer.convertCase(source, TextCase.pascal).output, 'XmlHttpRequest');
    });

    test('snake_case does not shred the acronym into single letters', () {
      expect(transformer.convertCase(source, TextCase.snake).output, 'xml_http_request');
    });

    test('SCREAMING_SNAKE_CASE', () {
      expect(transformer.convertCase(source, TextCase.screamingSnake).output, 'XML_HTTP_REQUEST');
    });

    test('kebab-case', () {
      expect(transformer.convertCase(source, TextCase.kebab).output, 'xml-http-request');
    });

    test('Train-Case', () {
      expect(transformer.convertCase(source, TextCase.train).output, 'Xml-Http-Request');
    });

    test('dot.case', () {
      expect(transformer.convertCase(source, TextCase.dot).output, 'xml.http.request');
    });

    test('Title Case', () {
      expect(transformer.convertCase(source, TextCase.title).output, 'Xml Http Request');
    });

    test('Sentence case', () {
      expect(transformer.convertCase(source, TextCase.sentence).output, 'Xml http request');
    });

    test('lowercase preserves layout (no re-splitting)', () {
      expect(transformer.convertCase('Some-Thing_Here', TextCase.lower).output, 'some-thing_here');
    });

    test('UPPERCASE preserves layout (no re-splitting)', () {
      expect(transformer.convertCase('Some-Thing_Here', TextCase.upper).output, 'SOME-THING_HERE');
    });

    test('a snake_case source converts cleanly to camelCase', () {
      expect(transformer.convertCase('user_name_id', TextCase.camel).output, 'userNameId');
    });

    test('a kebab-case source converts cleanly to PascalCase', () {
      expect(transformer.convertCase('user-name-id', TextCase.pascal).output, 'UserNameId');
    });

    test('digits form their own word boundary', () {
      expect(transformer.convertCase('parseHTTP2Response', TextCase.snake).output, 'parse_http_2_response');
    });
  });

  group('splitWords boundary detection', () {
    test('splits camelCase at lower-to-upper boundary', () {
      expect(TextCaseConverter.splitWords('fooBar'), ['foo', 'Bar']);
    });

    test('splits acronym-followed-by-word at the acronym end, not every capital', () {
      expect(TextCaseConverter.splitWords('XMLHttpRequest'), ['XML', 'Http', 'Request']);
    });

    test('splits on non-alphanumeric separators', () {
      expect(TextCaseConverter.splitWords('user_name-id.here'), ['user', 'name', 'id', 'here']);
    });
  });

  group('slugify', () {
    test('accented characters are folded to their ASCII base', () {
      expect(transformer.slugify('Café déjà vu').output, 'cafe-deja-vu');
    });

    test('punctuation is stripped and runs of separators collapse', () {
      expect(transformer.slugify('Hello, World!!! -- Foo').output, 'hello-world-foo');
    });

    test('ligatures expand per the fold table (ß -> ss, æ -> ae)', () {
      expect(transformer.slugify('Straße').output, 'strasse');
      expect(transformer.slugify('Ærøskøbing').output, 'aeroskobing');
    });

    test('a custom separator is honored', () {
      expect(transformer.slugify('Hello World', separator: '_').output, 'hello_world');
    });

    test('lowercase: false preserves case', () {
      expect(transformer.slugify('Hello World', lowercase: false).output, 'Hello-World');
    });

    test('maxLength truncates at a separator boundary, not mid-word', () {
      final result = transformer.slugify('one two three four five', maxLength: 10);
      expect(result.output.length, lessThanOrEqualTo(10));
      expect(result.output.endsWith('-'), isFalse);
      // The hard cut at 10 chars lands inside "three" ("one-two-th"); the
      // dangling partial word must be trimmed back to the last full word.
      expect(result.output, 'one-two');
    });

    test('maxLength below 1 is rejected', () {
      expect(() => transformer.slugify('hello', maxLength: 0), throwsA(isA<ArgumentError>()));
    });

    test('leading and trailing punctuation does not leave a dangling separator', () {
      expect(transformer.slugify('  --Hello World--  ').output, 'hello-world');
    });

    test('empty input produces an empty slug without throwing', () {
      expect(transformer.slugify('').output, '');
    });
  });

  group('line operations', () {
    const runner = LineOperationRunner();

    test('sort — ascending lexicographic', () {
      final result = runner.execute(
        const LineOperationInput(text: 'banana\napple\ncherry', operation: LineOperation.sort),
      );
      expect(result.output, 'apple\nbanana\ncherry');
    });

    test('sort — descending', () {
      final result = runner.execute(
        const LineOperationInput(
          text: 'banana\napple\ncherry',
          operation: LineOperation.sort,
          descending: true,
        ),
      );
      expect(result.output, 'cherry\nbanana\napple');
    });

    test('sort — case-insensitive treats "Apple" and "banana" fairly', () {
      final result = runner.execute(
        const LineOperationInput(
          text: 'banana\nApple\ncherry',
          operation: LineOperation.sort,
          caseInsensitive: true,
        ),
      );
      expect(result.output, 'Apple\nbanana\ncherry');
    });

    test('sort — natural order puts item2 before item10', () {
      final result = runner.execute(
        const LineOperationInput(
          text: 'item10\nitem2\nitem1',
          operation: LineOperation.sort,
          natural: true,
        ),
      );
      expect(result.output, 'item1\nitem2\nitem10');
    });

    test('sort — without natural order, item10 sorts before item2 lexicographically', () {
      final result = runner.execute(
        const LineOperationInput(text: 'item10\nitem2', operation: LineOperation.sort),
      );
      expect(result.output, 'item10\nitem2');
    });

    test('deduplicate — keeps first occurrence, drops later repeats', () {
      final result = runner.execute(
        const LineOperationInput(text: 'a\nb\na\nc\nb', operation: LineOperation.deduplicate),
      );
      expect(result.output, 'a\nb\nc');
    });

    test('deduplicate — case-insensitive treats "A" and "a" as duplicates', () {
      final result = runner.execute(
        const LineOperationInput(
          text: 'a\nA\nb',
          operation: LineOperation.deduplicate,
          caseInsensitive: true,
        ),
      );
      expect(result.output, 'a\nb');
    });

    test('reverse — reverses line order', () {
      final result = runner.execute(
        const LineOperationInput(text: 'one\ntwo\nthree', operation: LineOperation.reverse),
      );
      expect(result.output, 'three\ntwo\none');
    });

    test('trim — trims leading/trailing whitespace from each line', () {
      final result = runner.execute(
        const LineOperationInput(text: '  hi  \n\tthere\t', operation: LineOperation.trim),
      );
      expect(result.output, 'hi\nthere');
    });

    test('removeBlank — drops blank/whitespace-only lines', () {
      final result = runner.execute(
        const LineOperationInput(text: 'a\n\n  \nb\n', operation: LineOperation.removeBlank),
      );
      expect(result.output, 'a\nb');
    });

    test('number — adds sequential, right-aligned numbers by default', () {
      final result = runner.execute(
        const LineOperationInput(text: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj', operation: LineOperation.number),
      );
      final lines = result.output.split('\n');
      expect(lines.first, ' 1. a');
      expect(lines.last, '10. j');
    });

    test('number — custom start and separator, no padding', () {
      final result = runner.execute(
        const LineOperationInput(
          text: 'a\nb',
          operation: LineOperation.number,
          startNumber: 5,
          numberSeparator: ') ',
          padNumbers: false,
        ),
      );
      expect(result.output, '5) a\n6) b');
    });

    test('splitLines drops a single trailing empty line from a trailing newline', () {
      expect(LineOperationRunner.splitLines('a\nb\n'), ['a', 'b']);
    });

    test('splitLines handles CRLF and CR alike', () {
      expect(LineOperationRunner.splitLines('a\r\nb\rc'), ['a', 'b', 'c']);
    });

    test('empty input for a line operation returns empty output without throwing', () {
      final result = runner.execute(const LineOperationInput(text: '', operation: LineOperation.sort));
      expect(result.output, '');
      expect(result.lineCount, 0);
    });
  });

  group('empty input handled without throwing for every mode', () {
    test('case conversion of empty text yields empty output', () {
      for (final target in TextCase.values) {
        expect(() => transformer.convertCase('', target), returnsNormally);
        expect(transformer.convertCase('', target).output, '');
      }
    });

    test('slugify of empty text yields empty output', () {
      expect(() => transformer.slugify(''), returnsNormally);
    });

    test('every line operation on empty text yields empty output', () {
      const runner = LineOperationRunner();
      for (final op in LineOperation.values) {
        final result = runner.execute(LineOperationInput(text: '', operation: op));
        expect(result.output, '');
        expect(result.lineCount, 0);
      }
    });
  });
}
