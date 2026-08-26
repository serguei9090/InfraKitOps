import 'package:xml/xml.dart';

import '../ports/i_tool_use_case.dart';

enum XmlFormatMode { pretty, minify, validate }

class XmlFormatterInput {
  const XmlFormatterInput({
    required this.source,
    required this.mode,
    this.indent = '  ',
  });

  final String source;
  final XmlFormatMode mode;
  final String indent;
}

class XmlFormatterResult {
  const XmlFormatterResult({required this.isValid, this.output, this.errorMessage});

  final bool isValid;
  final String? output;
  final String? errorMessage;
}

class XmlFormatter implements IToolUseCase<XmlFormatterInput, XmlFormatterResult> {
  const XmlFormatter();

  @override
  XmlFormatterResult execute(XmlFormatterInput input) {
    XmlDocument document;
    try {
      document = XmlDocument.parse(input.source);
    } catch (e) {
      return XmlFormatterResult(isValid: false, errorMessage: 'Invalid XML: $e');
    }

    switch (input.mode) {
      case XmlFormatMode.validate:
        return const XmlFormatterResult(isValid: true, output: 'Valid XML');
      case XmlFormatMode.pretty:
        // Collapse whitespace-only text nodes left over from the original
        // formatting so re-indenting doesn't leave stray blank lines.
        document.normalize(trimAllWhitespace: true);
        final output = document.toXmlString(pretty: true, indent: input.indent);
        return XmlFormatterResult(isValid: true, output: output);
      case XmlFormatMode.minify:
        document.normalize(trimAllWhitespace: true);
        final output = document.toXmlString(pretty: false);
        return XmlFormatterResult(isValid: true, output: output);
    }
  }
}
