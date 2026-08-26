import 'dart:convert';

import '../ports/i_tool_use_case.dart';

enum Base64Operation { encode, decode }

class Base64ConversionInput {
  const Base64ConversionInput({required this.text, required this.operation});

  final String text;
  final Base64Operation operation;
}

class Base64ConversionResult {
  const Base64ConversionResult({required this.output});

  final String output;
}

/// Encodes/decodes UTF-8 text to and from standard Base64.
class Base64Converter implements IToolUseCase<Base64ConversionInput, Base64ConversionResult> {
  const Base64Converter();

  @override
  Base64ConversionResult execute(Base64ConversionInput input) {
    switch (input.operation) {
      case Base64Operation.encode:
        return Base64ConversionResult(output: base64Encode(utf8.encode(input.text)));
      case Base64Operation.decode:
        return Base64ConversionResult(output: _decode(input.text));
    }
  }

  String _decode(String text) {
    final cleaned = text.replaceAll(RegExp(r'\s'), '');
    if (cleaned.isEmpty) {
      throw ArgumentError('Input is empty');
    }

    // Accept input pasted without its trailing '=' padding by restoring it,
    // since that is the most common way hand-typed Base64 breaks.
    final padded = cleaned.length % 4 == 0 ? cleaned : cleaned.padRight(cleaned.length + (4 - cleaned.length % 4), '=');

    try {
      final bytes = base64Decode(padded);
      return utf8.decode(bytes);
    } on FormatException catch (e) {
      throw FormatException('Invalid Base64 input: ${e.message}');
    }
  }
}
