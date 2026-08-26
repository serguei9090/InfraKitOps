import 'dart:convert';

import '../ports/i_tool_use_case.dart';

enum JsonFormatMode { pretty, minify, validate }

class JsonFormatterInput {
  const JsonFormatterInput({
    required this.source,
    required this.mode,
    this.indent = '  ',
  });

  final String source;
  final JsonFormatMode mode;
  final String indent;
}

class JsonFormatterResult {
  const JsonFormatterResult({required this.isValid, this.output, this.errorMessage});

  final bool isValid;
  final String? output;
  final String? errorMessage;
}

class JsonFormatter implements IToolUseCase<JsonFormatterInput, JsonFormatterResult> {
  const JsonFormatter();

  @override
  JsonFormatterResult execute(JsonFormatterInput input) {
    dynamic decoded;
    try {
      decoded = jsonDecode(input.source);
    } on FormatException catch (e) {
      return JsonFormatterResult(isValid: false, errorMessage: 'Invalid JSON: ${e.message}');
    }

    switch (input.mode) {
      case JsonFormatMode.validate:
        return const JsonFormatterResult(isValid: true, output: 'Valid JSON');
      case JsonFormatMode.pretty:
        final output = JsonEncoder.withIndent(input.indent).convert(decoded);
        return JsonFormatterResult(isValid: true, output: output);
      case JsonFormatMode.minify:
        final output = const JsonEncoder().convert(decoded);
        return JsonFormatterResult(isValid: true, output: output);
    }
  }
}
