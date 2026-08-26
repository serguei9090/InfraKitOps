import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/web_encoders.dart';

void main() {
  const encoder = WebEncoder();

  test('URL-encodes reserved characters', () {
    final result = encoder.execute(
      const WebEncodingInput(text: 'a b&c=d', operation: WebEncodingOperation.urlEncode),
    );
    expect(result.output, 'a%20b%26c%3Dd');
  });

  test('URL-decodes percent sequences', () {
    final result = encoder.execute(
      const WebEncodingInput(text: 'a%20b%26c%3Dd', operation: WebEncodingOperation.urlDecode),
    );
    expect(result.output, 'a b&c=d');
  });

  test('rejects malformed percent-encoding', () {
    expect(
      () => encoder.execute(
        const WebEncodingInput(text: '100% done %', operation: WebEncodingOperation.urlDecode),
      ),
      throwsFormatException,
    );
  });

  test('escapes HTML special characters', () {
    final result = encoder.execute(
      const WebEncodingInput(text: '<a href="x">Tom & Jerry\'s</a>', operation: WebEncodingOperation.htmlEscape),
    );
    expect(result.output, '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
  });

  test('unescapes HTML entities including numeric ones', () {
    final result = encoder.execute(
      const WebEncodingInput(
        text: '&lt;b&gt;Caf&#233; &amp; Bar&lt;/b&gt;',
        operation: WebEncodingOperation.htmlUnescape,
      ),
    );
    expect(result.output, '<b>Café & Bar</b>');
  });
}
