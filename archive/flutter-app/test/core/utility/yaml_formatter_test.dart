import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/yaml_formatter.dart';

void main() {
  const formatter = YamlFormatter();

  test('pretty-prints a map with a nested list', () {
    final result = formatter.execute(
      const YamlFormatterInput(source: 'a: 1\nb:\n  - x\n  - y\n', mode: YamlFormatMode.pretty),
    );

    expect(result.isValid, isTrue);
    expect(result.output, 'a: 1\nb:\n  - x\n  - y');
  });

  test('minifies to single-line flow style', () {
    final result = formatter.execute(
      const YamlFormatterInput(source: 'a: 1\nb:\n  - x\n  - y\n', mode: YamlFormatMode.minify),
    );

    expect(result.isValid, isTrue);
    expect(result.output, '{a: 1, b: [x, y]}');
  });

  test('validate reports valid YAML', () {
    final result = formatter.execute(
      const YamlFormatterInput(source: 'a: 1', mode: YamlFormatMode.validate),
    );

    expect(result.isValid, isTrue);
  });

  test('rejects malformed YAML with an unclosed flow collection', () {
    final result = formatter.execute(
      const YamlFormatterInput(source: 'foo: [1, 2', mode: YamlFormatMode.validate),
    );

    expect(result.isValid, isFalse);
    expect(result.errorMessage, isNotNull);
  });
}
