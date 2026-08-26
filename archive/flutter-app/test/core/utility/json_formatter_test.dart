import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/json_formatter.dart';

void main() {
  const formatter = JsonFormatter();

  test('pretty-prints with two-space indent', () {
    final result = formatter.execute(
      const JsonFormatterInput(source: '{"a":1,"b":[1,2]}', mode: JsonFormatMode.pretty),
    );

    expect(result.isValid, isTrue);
    expect(result.output, contains('\n'));
    expect(result.output, contains('  "a": 1'));
    expect(jsonDecode(result.output!), {'a': 1, 'b': [1, 2]});
  });

  test('minifies whitespace out of formatted JSON', () {
    final result = formatter.execute(
      const JsonFormatterInput(
        source: '{\n  "a" : 1,\n  "b" : [1, 2]\n}',
        mode: JsonFormatMode.minify,
      ),
    );

    expect(result.isValid, isTrue);
    expect(result.output, '{"a":1,"b":[1,2]}');
  });

  test('validate reports valid JSON without altering it', () {
    final result = formatter.execute(
      const JsonFormatterInput(source: '{"a":1}', mode: JsonFormatMode.validate),
    );

    expect(result.isValid, isTrue);
  });

  test('rejects malformed JSON with an error message', () {
    final result = formatter.execute(
      const JsonFormatterInput(source: '{"a":1,}', mode: JsonFormatMode.validate),
    );

    expect(result.isValid, isFalse);
    expect(result.errorMessage, isNotNull);
    expect(result.output, isNull);
  });
}
