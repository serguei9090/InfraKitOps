import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/xml_formatter.dart';

void main() {
  const formatter = XmlFormatter();

  test('pretty-prints nested elements with indentation', () {
    final result = formatter.execute(
      const XmlFormatterInput(source: '<root><a>1</a><b>2</b></root>', mode: XmlFormatMode.pretty),
    );

    expect(result.isValid, isTrue);
    expect(result.output, contains('\n'));
    expect(result.output, contains('  <a>1</a>'));
    expect(result.output, contains('  <b>2</b>'));
  });

  test('minifies away insignificant whitespace between tags', () {
    final result = formatter.execute(
      const XmlFormatterInput(
        source: '<root>\n  <a>1</a>\n  <b>2</b>\n</root>',
        mode: XmlFormatMode.minify,
      ),
    );

    expect(result.isValid, isTrue);
    expect(result.output, '<root><a>1</a><b>2</b></root>');
  });

  test('validate reports valid XML', () {
    final result = formatter.execute(
      const XmlFormatterInput(source: '<root/>', mode: XmlFormatMode.validate),
    );

    expect(result.isValid, isTrue);
  });

  test('rejects malformed XML with mismatched tags', () {
    final result = formatter.execute(
      const XmlFormatterInput(source: '<root><a></root>', mode: XmlFormatMode.validate),
    );

    expect(result.isValid, isFalse);
    expect(result.errorMessage, isNotNull);
  });
}
