import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/json_to_csv.dart';

void main() {
  const converter = JsonToCsvConverter();

  group('header union across differing key sets', () {
    test('objects with different keys union into one header, first-seen order, empty cells for missing keys', () {
      const json = '[{"a": 1, "b": 2}, {"b": 3, "c": 4}]';

      final result = converter.execute(const JsonToCsvInput(json: json));

      expect(result.headers, ['a', 'b', 'c']);
      expect(result.rowCount, 2);

      final lines = result.csv.split('\r\n')..removeWhere((l) => l.isEmpty);
      expect(lines[0], 'a,b,c');
      expect(lines[1], '1,2,'); // row 1 has no "c"
      expect(lines[2], ',3,4'); // row 2 has no "a"
    });
  });

  group('nested object flattening', () {
    test('nested objects flatten to dotted paths', () {
      const json = '[{"user": {"name": "Ann", "age": 30}}, {"user": {"name": "Bo", "age": 41}}]';

      final result = converter.execute(const JsonToCsvInput(json: json));

      expect(result.headers, ['user.name', 'user.age']);
      final lines = result.csv.split('\r\n')..removeWhere((l) => l.isEmpty);
      expect(lines[0], 'user.name,user.age');
      expect(lines[1], 'Ann,30');
      expect(lines[2], 'Bo,41');
    });

    test('deeply nested objects flatten through multiple levels', () {
      const json = '[{"a": {"b": {"c": 1}}}]';
      final result = converter.execute(const JsonToCsvInput(json: json));
      expect(result.headers, ['a.b.c']);
    });

    test('empty nested object contributes no columns', () {
      const json = '[{"a": 1, "b": {}}]';
      final result = converter.execute(const JsonToCsvInput(json: json));
      expect(result.headers, ['a']);
    });

    test('null values become empty cells', () {
      const json = '[{"a": null}]';
      final result = converter.execute(const JsonToCsvInput(json: json));
      // Header row "a", then one data row that is a single empty cell —
      // the row itself is an empty string before its line ending, so a
      // blanket "remove empty lines" filter would wrongly eat it.
      expect(result.csv, 'a\r\n\r\n');
    });
  });

  group('array handling', () {
    test('default index-suffixed columns for nested arrays', () {
      const json = '[{"tags": ["a", "b"]}]';
      final result = converter.execute(const JsonToCsvInput(json: json));
      expect(result.headers, ['tags.0', 'tags.1']);
      final lines = result.csv.split('\r\n')..removeWhere((l) => l.isEmpty);
      expect(lines[1], 'a,b');
    });

    test('objects inside arrays keep flattening with indexed columns', () {
      const json = '[{"users": [{"name": "x"}]}]';
      final result = converter.execute(const JsonToCsvInput(json: json));
      expect(result.headers, ['users.0.name']);
    });

    test('JSON-encoded array handling keeps the array in one cell', () {
      const json = '[{"tags": ["a", "b"]}]';
      final result = converter.execute(
        const JsonToCsvInput(json: json, arrayHandling: CsvArrayHandling.jsonEncoded),
      );
      expect(result.headers, ['tags']);
      final lines = result.csv.split('\r\n')..removeWhere((l) => l.isEmpty);
      // The cell holds the compact JSON of the array; it contains a comma
      // and must therefore be quoted per RFC 4180.
      expect(lines[1], '"[""a"",""b""]"');
    });

    test('empty array contributes no columns', () {
      const json = '[{"a": 1, "tags": []}]';
      final result = converter.execute(const JsonToCsvInput(json: json));
      expect(result.headers, ['a']);
    });
  });

  group('RFC 4180 quoting', () {
    test('a field with comma, double quote AND newline is escaped exactly per RFC 4180', () {
      // Field value: He said "hi, there"\nBye
      const value = 'He said "hi, there"\nBye';

      final result = converter.execute(JsonToCsvInput(json: '[{"note": ${_jsonEncode(value)}}]'));

      // The field's internal newline is preserved as-is (LF, from the
      // source value) inside the quotes; only the embedded double quotes
      // are doubled. The \r\n after the closing quote is the row's own
      // line ending (CRLF, the default per RFC 4180), not part of escaping.
      const expectedEscaped = '"He said ""hi, there""\nBye"';
      expect(result.csv, 'note\r\n$expectedEscaped\r\n');
    });

    test('escapeCsvField quotes a field containing the delimiter', () {
      expect(JsonToCsvConverter.escapeCsvField('a,b', ','), '"a,b"');
    });

    test('escapeCsvField quotes and doubles embedded double quotes', () {
      expect(JsonToCsvConverter.escapeCsvField('say "hi"', ','), '"say ""hi"""');
    });

    test('escapeCsvField quotes a field containing a newline', () {
      expect(JsonToCsvConverter.escapeCsvField('line1\nline2', ','), '"line1\nline2"');
    });

    test('escapeCsvField quotes a field containing a carriage return', () {
      expect(JsonToCsvConverter.escapeCsvField('a\rb', ','), '"a\rb"');
    });

    test('escapeCsvField leaves a plain field bare', () {
      expect(JsonToCsvConverter.escapeCsvField('plain', ','), 'plain');
    });

    test('escapeCsvField only quotes for the active delimiter, not other punctuation', () {
      // A comma inside a field must NOT force quoting when the delimiter is
      // a semicolon.
      expect(JsonToCsvConverter.escapeCsvField('a,b', ';'), 'a,b');
      expect(JsonToCsvConverter.escapeCsvField('a;b', ';'), '"a;b"');
    });
  });

  group('configurable delimiter', () {
    test('semicolon delimiter is used for both header and rows', () {
      const json = '[{"a": 1, "b": 2}]';
      final result = converter.execute(
        const JsonToCsvInput(json: json, delimiter: CsvDelimiter.semicolon),
      );
      final lines = result.csv.split('\r\n')..removeWhere((l) => l.isEmpty);
      expect(lines[0], 'a;b');
      expect(lines[1], '1;2');
    });

    test('tab delimiter is used for both header and rows', () {
      const json = '[{"a": 1, "b": 2}]';
      final result = converter.execute(
        const JsonToCsvInput(json: json, delimiter: CsvDelimiter.tab),
      );
      final lines = result.csv.split('\r\n')..removeWhere((l) => l.isEmpty);
      expect(lines[0], 'a\tb');
      expect(lines[1], '1\t2');
    });
  });

  group('line ending option', () {
    test('LF line ending produces \\n separated lines with no \\r', () {
      const json = '[{"a": 1}]';
      final result = converter.execute(
        const JsonToCsvInput(json: json, lineEnding: CsvLineEnding.lf),
      );
      expect(result.csv.contains('\r'), isFalse);
      expect(result.csv, 'a\n1\n');
    });
  });

  group('header option', () {
    test('includeHeader: false omits the header row', () {
      const json = '[{"a": 1}, {"a": 2}]';
      final result = converter.execute(
        const JsonToCsvInput(json: json, includeHeader: false),
      );
      expect(result.csv, '1\r\n2\r\n');
    });
  });

  group('error handling', () {
    test('empty input is rejected', () {
      expect(
        () => converter.execute(const JsonToCsvInput(json: '   ')),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('invalid JSON throws a clean FormatException', () {
      expect(
        () => converter.execute(const JsonToCsvInput(json: '{not json')),
        throwsA(isA<FormatException>()),
      );
    });

    test('a top-level JSON object (not array) is rejected', () {
      expect(
        () => converter.execute(const JsonToCsvInput(json: '{"a": 1}')),
        throwsA(
          isA<FormatException>().having((e) => e.message, 'message', contains('array of objects')),
        ),
      );
    });

    test('a top-level JSON scalar is rejected', () {
      expect(
        () => converter.execute(const JsonToCsvInput(json: '42')),
        throwsA(isA<FormatException>()),
      );
    });

    test('an empty JSON array is rejected', () {
      expect(
        () => converter.execute(const JsonToCsvInput(json: '[]')),
        throwsA(isA<FormatException>()),
      );
    });

    test('an array element that is not an object is rejected with a clear message', () {
      expect(
        () => converter.execute(const JsonToCsvInput(json: '[{"a": 1}, "oops"]')),
        throwsA(
          isA<FormatException>().having((e) => e.message, 'message', contains('Element 2')),
        ),
      );
    });
  });
}

// Helper kept local to this file: minimal JSON string escaping for building
// input literals in the RFC 4180 test above, independent of dart:convert's
// jsonEncode so the test input is constructed by hand for clarity.
String _jsonEncode(String value) {
  final escaped = value
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"')
      .replaceAll('\n', '\\n')
      .replaceAll('\r', '\\r');
  return '"$escaped"';
}
