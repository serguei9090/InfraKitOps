import 'package:yaml/yaml.dart';

import '../ports/i_tool_use_case.dart';

enum YamlFormatMode { pretty, minify, validate }

class YamlFormatterInput {
  const YamlFormatterInput({
    required this.source,
    required this.mode,
    this.indentSize = 2,
  });

  final String source;
  final YamlFormatMode mode;
  final int indentSize;
}

class YamlFormatterResult {
  const YamlFormatterResult({required this.isValid, this.output, this.errorMessage});

  final bool isValid;
  final String? output;
  final String? errorMessage;
}

/// Hand-rolled YAML formatter. The `yaml` package only ships a parser, not
/// an emitter, so pretty-printing here means walking the parsed tree
/// (nested `Map`/`List`/scalars) and re-indenting it manually. Known
/// limitations of this approach: comments, anchors/aliases, tags, and
/// multi-document streams are not preserved (the parser itself discards
/// most of these), and "minify" re-emits the document in single-line flow
/// style ({}/[]) since YAML has no whitespace-free representation the way
/// JSON does.
class YamlFormatter implements IToolUseCase<YamlFormatterInput, YamlFormatterResult> {
  const YamlFormatter();

  @override
  YamlFormatterResult execute(YamlFormatterInput input) {
    dynamic parsed;
    try {
      parsed = loadYaml(input.source);
    } on YamlException catch (e) {
      return YamlFormatterResult(isValid: false, errorMessage: 'Invalid YAML: ${e.message}');
    }

    switch (input.mode) {
      case YamlFormatMode.validate:
        return const YamlFormatterResult(isValid: true, output: 'Valid YAML');
      case YamlFormatMode.minify:
        return YamlFormatterResult(isValid: true, output: _writeFlow(parsed));
      case YamlFormatMode.pretty:
        final buffer = StringBuffer();
        _writeBlock(buffer, parsed, 0, input.indentSize);
        final output = buffer.toString().trimRight();
        return YamlFormatterResult(isValid: true, output: output.isEmpty ? 'null' : output);
    }
  }

  bool _isCollection(dynamic value) => value is Map || value is List;

  void _writeBlock(StringBuffer buffer, dynamic node, int level, int indentSize) {
    final pad = ' ' * (level * indentSize);
    if (node is Map) {
      if (node.isEmpty) {
        buffer.writeln('$pad{}');
        return;
      }
      for (final entry in node.entries) {
        final key = _scalarToString(entry.key);
        final value = entry.value;
        final isEmptyCollection =
            (value is Map && value.isEmpty) || (value is List && value.isEmpty);
        if (_isCollection(value) && !isEmptyCollection) {
          buffer.writeln('$pad$key:');
          _writeBlock(buffer, value, level + 1, indentSize);
        } else if (_isCollection(value)) {
          buffer.writeln('$pad$key: ${value is Map ? '{}' : '[]'}');
        } else {
          buffer.writeln('$pad$key: ${_scalarToString(value)}');
        }
      }
    } else if (node is List) {
      if (node.isEmpty) {
        buffer.writeln('$pad[]');
        return;
      }
      for (final item in node) {
        final isEmptyCollection =
            (item is Map && item.isEmpty) || (item is List && item.isEmpty);
        if (_isCollection(item) && !isEmptyCollection) {
          buffer.writeln('$pad-');
          _writeBlock(buffer, item, level + 1, indentSize);
        } else if (_isCollection(item)) {
          buffer.writeln('$pad- ${item is Map ? '{}' : '[]'}');
        } else {
          buffer.writeln('$pad- ${_scalarToString(item)}');
        }
      }
    } else {
      buffer.writeln('$pad${_scalarToString(node)}');
    }
  }

  String _writeFlow(dynamic node) {
    if (node is Map) {
      final parts = node.entries.map((entry) => '${_scalarToString(entry.key)}: ${_writeFlow(entry.value)}');
      return '{${parts.join(', ')}}';
    }
    if (node is List) {
      return '[${node.map(_writeFlow).join(', ')}]';
    }
    return _scalarToString(node);
  }

  String _scalarToString(dynamic value) {
    if (value == null) return 'null';
    if (value is bool || value is num) return value.toString();
    final text = value.toString();
    return _needsQuoting(text) ? _quote(text) : text;
  }

  bool _needsQuoting(String text) {
    if (text.isEmpty) return true;
    if (text.trim() != text) return true;
    if (text.contains('\n')) return true;
    if (_reservedWords.hasMatch(text)) return true;
    if (_numericLike.hasMatch(text)) return true;
    if (text.contains(': ') || text.endsWith(':')) return true;
    if (text.contains('#')) return true;
    if (_leadingSpecialChar.hasMatch(text)) return true;
    return false;
  }

  String _quote(String text) {
    final escaped = text.replaceAll('\\', r'\\').replaceAll('"', r'\"').replaceAll('\n', r'\n');
    return '"$escaped"';
  }

  static final _reservedWords = RegExp(r'^(true|false|null|~|yes|no|on|off)$', caseSensitive: false);
  static final _numericLike = RegExp(r'^-?\d+(\.\d+)?([eE][+-]?\d+)?$');
  static final _leadingSpecialChar = RegExp(r'''^[\[\]{}&*!|>%@`"'#,-]''');
}
