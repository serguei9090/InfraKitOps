import '../ports/i_tool_use_case.dart';

enum WebEncodingOperation { urlEncode, urlDecode, htmlEscape, htmlUnescape }

class WebEncodingInput {
  const WebEncodingInput({required this.text, required this.operation});

  final String text;
  final WebEncodingOperation operation;
}

class WebEncodingResult {
  const WebEncodingResult({required this.output});

  final String output;
}

const _htmlEscapes = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const _namedEntities = {
  'amp': '&',
  'lt': '<',
  'gt': '>',
  'quot': '"',
  'apos': "'",
  'nbsp': ' ',
};

final _entityPattern = RegExp(r'&(#[xX][0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);');

/// URL percent-encoding and HTML entity escaping, both hand-rolled since
/// neither needs a package: [Uri] already exposes percent-encoding, and the
/// HTML entity set required here is small and fixed.
class WebEncoder implements IToolUseCase<WebEncodingInput, WebEncodingResult> {
  const WebEncoder();

  @override
  WebEncodingResult execute(WebEncodingInput input) {
    switch (input.operation) {
      case WebEncodingOperation.urlEncode:
        return WebEncodingResult(output: Uri.encodeComponent(input.text));
      case WebEncodingOperation.urlDecode:
        return WebEncodingResult(output: _urlDecode(input.text));
      case WebEncodingOperation.htmlEscape:
        return WebEncodingResult(output: _htmlEscape(input.text));
      case WebEncodingOperation.htmlUnescape:
        return WebEncodingResult(output: _htmlUnescape(input.text));
    }
  }

  String _urlDecode(String text) {
    try {
      return Uri.decodeComponent(text);
    } on FormatException catch (e) {
      throw FormatException('Invalid percent-encoded input: ${e.message}');
    } on ArgumentError {
      throw const FormatException('Invalid percent-encoded input');
    }
  }

  String _htmlEscape(String text) {
    return text.replaceAllMapped(RegExp('[&<>"\']'), (m) => _htmlEscapes[m[0]]!);
  }

  String _htmlUnescape(String text) {
    return text.replaceAllMapped(_entityPattern, (match) {
      final token = match.group(1)!;
      if (token.startsWith('#x') || token.startsWith('#X')) {
        final code = int.parse(token.substring(2), radix: 16);
        return String.fromCharCode(code);
      }
      if (token.startsWith('#')) {
        final code = int.parse(token.substring(1));
        return String.fromCharCode(code);
      }
      return _namedEntities[token] ?? match.group(0)!;
    });
  }
}
