import 'dart:convert';

import 'package:toml/toml.dart';
import 'package:xml/xml.dart';
import 'package:yaml/yaml.dart';

import '../ports/i_tool_use_case.dart';

enum DataFormat {
  json('JSON'),
  yaml('YAML'),
  toml('TOML'),
  xml('XML');

  const DataFormat(this.label);

  final String label;
}

class DataFormatConversionInput {
  const DataFormatConversionInput({
    required this.source,
    required this.sourceFormat,
    required this.targetFormat,
  });

  final String source;
  final DataFormat sourceFormat;
  final DataFormat targetFormat;
}

class DataFormatConversionResult {
  const DataFormatConversionResult({required this.output});

  final String output;
}

/// Converts structured data between JSON, YAML, TOML and XML by parsing the
/// source into a canonical tree of Map/List/String/num/bool/null values and
/// re-serializing that tree in the target format.
class DataFormatConverter
    implements IToolUseCase<DataFormatConversionInput, DataFormatConversionResult> {
  const DataFormatConverter();

  @override
  DataFormatConversionResult execute(DataFormatConversionInput input) {
    if (input.source.trim().isEmpty) {
      throw ArgumentError('Input is empty');
    }

    dynamic tree;
    try {
      tree = _decode(input.sourceFormat, input.source);
    } catch (e) {
      throw FormatException('Failed to parse ${input.sourceFormat.label} input: $e');
    }

    final sanitized = _sanitize(tree);

    try {
      final output = _encode(input.targetFormat, sanitized);
      return DataFormatConversionResult(output: output);
    } catch (e) {
      throw FormatException('Failed to produce ${input.targetFormat.label} output: $e');
    }
  }

  dynamic _decode(DataFormat format, String source) {
    switch (format) {
      case DataFormat.json:
        return jsonDecode(source);
      case DataFormat.yaml:
        return loadYaml(source);
      case DataFormat.toml:
        return TomlDocument.parse(source).toMap();
      case DataFormat.xml:
        return _decodeXml(source);
    }
  }

  String _encode(DataFormat format, dynamic tree) {
    switch (format) {
      case DataFormat.json:
        return const JsonEncoder.withIndent('  ').convert(tree);
      case DataFormat.yaml:
        return _encodeYaml(tree);
      case DataFormat.toml:
        if (tree is! Map<String, dynamic>) {
          throw const FormatException('TOML requires an object at the root');
        }
        return TomlDocument.fromMap(tree).toString();
      case DataFormat.xml:
        return _encodeXml(tree);
    }
  }

  dynamic _sanitize(dynamic value) {
    if (value is Map) {
      final result = <String, dynamic>{};
      for (final entry in value.entries) {
        result[entry.key.toString()] = _sanitize(entry.value);
      }
      return result;
    }
    if (value is Iterable) {
      return value.map(_sanitize).toList();
    }
    if (value == null || value is String || value is num || value is bool) {
      return value;
    }
    // BigInt, TOML date/time values, etc. have no direct JSON/YAML
    // representation, so fall back to their canonical string form.
    return value.toString();
  }

  dynamic _decodeXml(String source) {
    final document = XmlDocument.parse(source);
    final root = document.rootElement;
    return <String, dynamic>{root.name.local: _xmlElementToValue(root)};
  }

  dynamic _xmlElementToValue(XmlElement element) {
    final result = <String, dynamic>{};
    for (final attribute in element.attributes) {
      result['@${attribute.name.local}'] = attribute.value;
    }

    for (final child in element.childElements) {
      final value = _xmlElementToValue(child);
      final key = child.name.local;
      if (result.containsKey(key)) {
        final existing = result[key];
        if (existing is List) {
          existing.add(value);
        } else {
          result[key] = [existing, value];
        }
      } else {
        result[key] = value;
      }
    }

    final text = element.children.whereType<XmlText>().map((t) => t.value).join().trim();

    if (element.childElements.isEmpty) {
      if (result.isEmpty) return text;
      if (text.isNotEmpty) result['#text'] = text;
      return result;
    }

    if (text.isNotEmpty) result['#text'] = text;
    return result;
  }

  String _encodeXml(dynamic tree) {
    if (tree is! Map<String, dynamic> || tree.isEmpty) {
      throw const FormatException('XML requires an object with a root element');
    }

    String rootName;
    dynamic rootValue;
    if (tree.length == 1 && tree.values.first is! List) {
      rootName = tree.keys.first;
      rootValue = tree.values.first;
    } else {
      rootName = 'root';
      rootValue = tree;
    }

    final builder = XmlBuilder();
    _buildXmlElement(builder, _sanitizeXmlName(rootName), rootValue);
    return builder.buildDocument().toXmlString(pretty: true, indent: '  ');
  }

  void _buildXmlElement(XmlBuilder builder, String name, dynamic value) {
    builder.element(
      name,
      nest: () {
        if (value is Map) {
          value.forEach((key, v) {
            final k = key.toString();
            if (k.startsWith('@')) {
              builder.attribute(k.substring(1), v);
            } else if (k == '#text') {
              builder.text(v.toString());
            } else if (v is List) {
              for (final item in v) {
                _buildXmlElement(builder, _sanitizeXmlName(k), item);
              }
            } else {
              _buildXmlElement(builder, _sanitizeXmlName(k), v);
            }
          });
        } else if (value != null) {
          builder.text(value.toString());
        }
      },
    );
  }

  String _sanitizeXmlName(String name) {
    var sanitized = name.replaceAll(RegExp(r'[^A-Za-z0-9_.-]'), '_');
    if (sanitized.isEmpty || RegExp(r'^[0-9.-]').hasMatch(sanitized)) {
      sanitized = '_$sanitized';
    }
    return sanitized;
  }

  String _encodeYaml(dynamic tree) {
    final buffer = StringBuffer();
    if (tree is Map) {
      if (tree.isEmpty) {
        buffer.writeln('{}');
      } else {
        _writeYamlMap(buffer, tree, 0);
      }
    } else if (tree is List) {
      if (tree.isEmpty) {
        buffer.writeln('[]');
      } else {
        _writeYamlList(buffer, tree, 0);
      }
    } else {
      buffer.writeln(_yamlScalar(tree));
    }
    return buffer.toString();
  }

  void _writeYamlMap(StringBuffer buffer, Map map, int indent) {
    final pad = '  ' * indent;
    map.forEach((key, value) {
      final k = _yamlKey(key.toString());
      if (value is Map && value.isNotEmpty) {
        buffer.writeln('$pad$k:');
        _writeYamlMap(buffer, value, indent + 1);
      } else if (value is List && value.isNotEmpty) {
        buffer.writeln('$pad$k:');
        _writeYamlList(buffer, value, indent);
      } else if (value is Map) {
        buffer.writeln('$pad$k: {}');
      } else if (value is List) {
        buffer.writeln('$pad$k: []');
      } else {
        buffer.writeln('$pad$k: ${_yamlScalar(value)}');
      }
    });
  }

  void _writeYamlList(StringBuffer buffer, List list, int indent) {
    final pad = '  ' * indent;
    for (final item in list) {
      if (item is Map && item.isNotEmpty) {
        buffer.writeln('$pad-');
        _writeYamlMap(buffer, item, indent + 1);
      } else if (item is List && item.isNotEmpty) {
        buffer.writeln('$pad-');
        _writeYamlList(buffer, item, indent + 1);
      } else if (item is Map) {
        buffer.writeln('$pad- {}');
      } else if (item is List) {
        buffer.writeln('$pad- []');
      } else {
        buffer.writeln('$pad- ${_yamlScalar(item)}');
      }
    }
  }

  String _yamlKey(String key) {
    if (RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(key)) return key;
    return jsonEncode(key);
  }

  String _yamlScalar(dynamic value) {
    if (value == null) return 'null';
    if (value is bool || value is num) return value.toString();
    final s = value.toString();
    if (s.isEmpty) return jsonEncode(s);
    final looksLikeOther = RegExp(
      r'^(true|false|null|~|-?[0-9]+(\.[0-9]+)?)$',
      caseSensitive: false,
    ).hasMatch(s);
    final isPlainSafe = RegExp(r'^[A-Za-z0-9_./][A-Za-z0-9_./ -]*$').hasMatch(s) && !looksLikeOther;
    if (isPlainSafe && s.trim() == s) return s;
    return jsonEncode(s);
  }
}
