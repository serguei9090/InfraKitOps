/// FormFlow's pure-Dart parsing/rendering engine: detects the structural
/// shape (fields, nesting, repeated groups) of an uploaded XML/YAML/JSON
/// file and re-serializes edited values back into the same format.
///
/// Zero Flutter imports — this is core business logic, unit-testable in
/// milliseconds, driven by [lib/adapters/ui/tools/form_flow_builder_screen.dart].
library;

import 'dart:convert';

import 'package:xml/xml.dart';
import 'package:yaml/yaml.dart';

import '../ports/i_form_flow_use_case.dart';
import 'schema_model.dart';

/// Synthetic key used as the sole child of an `array` field whose items are
/// scalars rather than objects — e.g. a JSON/YAML list of plain strings
/// (`["a", "b"]`), or repeated XML leaf siblings (`<tag>a</tag><tag>b</tag>`).
///
/// [SchemaField.children] always describes an item's shape as a list of
/// *named* fields (matching the object-item case, e.g. `<server>` with
/// `host`/`port` children). A scalar item has no natural key of its own, so
/// it is represented as a single-field template `[value: <type>]`, and the
/// corresponding runtime item map is `{'value': <the scalar>}`. The renderer
/// recognizes this exact shape and un-wraps it back to a bare scalar so the
/// re-serialized array matches the original flat structure instead of
/// nesting every item under a spurious `value` tag/key.
const scalarArrayItemKey = 'value';

/// Root display name used for YAML/JSON documents, which — unlike XML — have
/// no single wrapping tag of their own.
const _defaultRootName = 'root';

final _boolPattern = RegExp(r'^(true|false)$', caseSensitive: false);
final _numberPattern = RegExp(r'^-?\d+(\.\d+)?$');

/// Parses XML/YAML/JSON into a [FormFlowSchema] and renders edited values
/// back out in the same format.
///
/// ## Format detection
/// [parse] auto-detects the source format by trying, in order, JSON
/// (`dart:convert`'s `jsonDecode`), then XML (`package:xml`), then YAML
/// (`package:yaml`) — the first one that parses successfully wins. This
/// order matters: a YAML document is rarely valid JSON (unquoted keys), and
/// an XML document is rarely a valid YAML mapping, so ambiguity in practice
/// is minimal. Callers that already know the format (e.g. from a file
/// extension) can skip detection entirely via the optional [SourceFormat]
/// hint parameter — `parse(raw, formatHint: SourceFormat.yaml)` — which is
/// an addition to the [IFormFlowUseCase] contract (a valid override: it only
/// adds an *optional* parameter, so every call the interface allows still
/// works unchanged).
///
/// ## Structural auto-detection rules
/// - A leaf scalar is `boolean` if its text is (case-insensitively) `true`/
///   `false`, or if the decoded JSON/YAML value is already a native `bool`.
/// - A leaf scalar is `number` if its text matches an integer/decimal
///   pattern, or the decoded value is already a native `num`.
/// - Anything else scalar is `text`.
/// - A single nested non-repeating group (an XML element with child
///   elements, or a JSON/YAML object value) is `object`, with `children`
///   describing that group's own fields.
/// - A repeated sibling (multiple XML elements sharing a tag name under the
///   same parent, or a JSON/YAML list) is `array`. Its `children` is the
///   per-item template, derived from the *first* occurrence/element.
///
/// ## Known limitations (see class doc + README-style notes below)
/// - XML attributes are ignored entirely — only element text/children are
///   considered. Mixed content (text alongside child elements) is ignored in
///   favor of the child elements.
/// - `null` JSON/YAML values collapse to empty text; re-rendering does not
///   restore `null` (there is no `FieldType` for it).
/// - Type inference is content-based and re-runs on every parse: a `text`
///   field whose *current* value happens to look numeric/boolean (e.g. a
///   user types "123" into a field that was originally text) will be
///   re-detected as `number`/`boolean` if that rendered output is parsed
///   again. This is inherent to structural, content-driven auto-detection,
///   not a bug — schemas aren't preserved out-of-band.
/// - `package:yaml` is parse-only (no encoder), so YAML rendering is a
///   hand-written block-style writer here. It produces well-formed,
///   re-parseable YAML, but won't byte-for-byte match hand-authored
///   formatting/comments/anchors from the original file (comments and
///   anchors are not part of the schema model and are always dropped).
class FormFlowParser implements IFormFlowUseCase<FormFlowSchema> {
  const FormFlowParser();

  @override
  FormFlowSchema parse(String rawContent, {SourceFormat? formatHint}) {
    if (rawContent.trim().isEmpty) {
      throw const FormatException('Content is empty');
    }

    if (formatHint != null) {
      return switch (formatHint) {
        SourceFormat.json => _parseJson(rawContent),
        SourceFormat.xml => _parseXml(rawContent),
        SourceFormat.yaml => _parseYaml(rawContent),
      };
    }

    final errors = <String>[];
    try {
      return _parseJson(rawContent);
    } catch (e) {
      errors.add('as JSON: $e');
    }
    try {
      return _parseXml(rawContent);
    } catch (e) {
      errors.add('as XML: $e');
    }
    try {
      return _parseYaml(rawContent);
    } catch (e) {
      errors.add('as YAML: $e');
    }
    throw FormatException(
      'Could not detect a supported format (tried JSON, XML, YAML):\n'
      '${errors.join('\n')}',
    );
  }

  @override
  String render(FormFlowSchema schema, Map<String, Object?> values) {
    return switch (schema.format) {
      SourceFormat.json => _renderJson(schema, values),
      SourceFormat.xml => _renderXml(schema, values),
      SourceFormat.yaml => _renderYaml(schema, values),
    };
  }

  // ---------------------------------------------------------------------
  // JSON
  // ---------------------------------------------------------------------

  FormFlowSchema _parseJson(String raw) {
    final decoded = jsonDecode(raw);
    if (decoded is! Map) {
      throw const FormatException('JSON root must be an object');
    }
    return FormFlowSchema(
      format: SourceFormat.json,
      rootName: _defaultRootName,
      fields: _fieldsFromMap(decoded),
    );
  }

  String _renderJson(FormFlowSchema schema, Map<String, Object?> values) {
    final map = _mapFromFields(schema.fields, values);
    return const JsonEncoder.withIndent('  ').convert(map);
  }

  // ---------------------------------------------------------------------
  // YAML
  // ---------------------------------------------------------------------

  FormFlowSchema _parseYaml(String raw) {
    final decoded = loadYaml(raw);
    if (decoded is! Map) {
      throw const FormatException('YAML root must be a mapping');
    }
    return FormFlowSchema(
      format: SourceFormat.yaml,
      rootName: _defaultRootName,
      fields: _fieldsFromMap(decoded),
    );
  }

  String _renderYaml(FormFlowSchema schema, Map<String, Object?> values) {
    final map = _mapFromFields(schema.fields, values);
    final buffer = StringBuffer();
    if (map.isEmpty) {
      return '{}\n';
    }
    _writeYamlMapEntries(buffer, map, 0);
    return buffer.toString();
  }

  void _writeYamlMapEntries(StringBuffer buffer, Map<String, Object?> map, int indent) {
    for (final entry in map.entries) {
      _writeYamlMapEntry(buffer, entry.key, entry.value, indent);
    }
  }

  void _writeYamlMapEntry(StringBuffer buffer, String key, Object? value, int indent, {String? prefix}) {
    final pad = prefix ?? '  ' * indent;
    if (value is Map) {
      final m = Map<String, Object?>.from(value);
      if (m.isEmpty) {
        buffer.writeln('$pad$key: {}');
      } else {
        buffer.writeln('$pad$key:');
        _writeYamlMapEntries(buffer, m, indent + 1);
      }
    } else if (value is List) {
      if (value.isEmpty) {
        buffer.writeln('$pad$key: []');
      } else {
        buffer.writeln('$pad$key:');
        for (final item in value) {
          _writeYamlListItem(buffer, item, indent + 1);
        }
      }
    } else {
      buffer.writeln('$pad$key: ${_yamlScalar(value)}');
    }
  }

  void _writeYamlListItem(StringBuffer buffer, Object? item, int indent) {
    final pad = '  ' * indent;
    if (item is Map) {
      final m = Map<String, Object?>.from(item);
      if (m.isEmpty) {
        buffer.writeln('$pad- {}');
        return;
      }
      final entries = m.entries.toList();
      _writeYamlMapEntry(buffer, entries.first.key, entries.first.value, indent, prefix: '$pad- ');
      for (final entry in entries.skip(1)) {
        _writeYamlMapEntry(buffer, entry.key, entry.value, indent + 1);
      }
    } else if (item is List) {
      if (item.isEmpty) {
        buffer.writeln('$pad- []');
      } else {
        buffer.writeln('$pad-');
        for (final sub in item) {
          _writeYamlListItem(buffer, sub, indent + 1);
        }
      }
    } else {
      buffer.writeln('$pad- ${_yamlScalar(item)}');
    }
  }

  String _yamlScalar(Object? value) {
    if (value == null) return 'null';
    if (value is bool || value is num) return value.toString();
    final text = value.toString();
    if (text.isEmpty) return "''";
    if (_yamlNeedsQuoting(text)) {
      final escaped = text.replaceAll('\\', r'\\').replaceAll('"', r'\"');
      return '"$escaped"';
    }
    return text;
  }

  bool _yamlNeedsQuoting(String text) {
    if (RegExp(r'^\s|\s$').hasMatch(text)) return true;
    if (RegExp(r'^(true|false|null|yes|no|on|off|~)$', caseSensitive: false).hasMatch(text)) return true;
    if (_numberPattern.hasMatch(text)) return true;
    if (RegExp('[:#\\[\\]{}>|*&!%@`"\'\n,]').hasMatch(text)) return true;
    if (text.startsWith('-') || text.startsWith('?')) return true;
    return false;
  }

  // ---------------------------------------------------------------------
  // XML
  // ---------------------------------------------------------------------

  FormFlowSchema _parseXml(String raw) {
    final doc = XmlDocument.parse(raw);
    final root = doc.rootElement;
    return FormFlowSchema(
      format: SourceFormat.xml,
      rootName: root.name.local,
      fields: _fieldsFromXmlChildren(root.childElements),
    );
  }

  String _renderXml(FormFlowSchema schema, Map<String, Object?> values) {
    final root = XmlElement(
      XmlName(schema.rootName),
      const [],
      _xmlChildrenFromFields(schema.fields, values),
    );
    final doc = XmlDocument([
      XmlDeclaration()
        ..version = '1.0'
        ..encoding = 'UTF-8',
      root,
    ]);
    return '${doc.toXmlString(pretty: true, indent: '  ')}\n';
  }

  List<SchemaField> _fieldsFromXmlChildren(Iterable<XmlElement> children) {
    final order = <String>[];
    final groups = <String, List<XmlElement>>{};
    for (final el in children) {
      final name = el.name.local;
      if (!groups.containsKey(name)) {
        order.add(name);
        groups[name] = <XmlElement>[];
      }
      groups[name]!.add(el);
    }

    final fields = <SchemaField>[];
    for (final name in order) {
      final group = groups[name]!;
      if (group.length > 1) {
        fields.add(SchemaField(key: name, type: FieldType.array, children: _xmlItemTemplateFields(group.first)));
      } else {
        fields.add(_fieldFromXmlElement(name, group.first));
      }
    }
    return fields;
  }

  List<SchemaField> _xmlItemTemplateFields(XmlElement el) {
    final childEls = el.childElements.toList();
    if (childEls.isEmpty) {
      return [_leafField(scalarArrayItemKey, el.innerText)];
    }
    return _fieldsFromXmlChildren(childEls);
  }

  SchemaField _fieldFromXmlElement(String name, XmlElement el) {
    final childEls = el.childElements.toList();
    if (childEls.isNotEmpty) {
      return SchemaField(key: name, type: FieldType.object, children: _fieldsFromXmlChildren(childEls));
    }
    return _leafField(name, el.innerText);
  }

  List<XmlNode> _xmlChildrenFromFields(List<SchemaField> fields, Map<String, Object?> values) {
    final nodes = <XmlNode>[];
    for (final field in fields) {
      nodes.addAll(_xmlNodesForField(field, values[field.key]));
    }
    return nodes;
  }

  List<XmlElement> _xmlNodesForField(SchemaField field, Object? rawValue) {
    switch (field.type) {
      case FieldType.array:
        final items = rawValue is List ? rawValue : const [];
        if (_isScalarArrayTemplate(field.children)) {
          final itemField = field.children.single.copyWith(key: field.key);
          return [
            for (final item in items) ..._xmlNodesForField(itemField, item is Map ? item[scalarArrayItemKey] : item),
          ];
        }
        return [
          for (final item in items)
            XmlElement(
              XmlName(field.key),
              const [],
              _xmlChildrenFromFields(field.children, item is Map ? Map<String, Object?>.from(item) : const {}),
            ),
        ];
      case FieldType.object:
        final itemValues = rawValue is Map ? Map<String, Object?>.from(rawValue) : <String, Object?>{};
        return [XmlElement(XmlName(field.key), const [], _xmlChildrenFromFields(field.children, itemValues))];
      case FieldType.boolean:
        return [_xmlLeaf(field.key, _coerceBool(rawValue, field.defaultValue).toString())];
      case FieldType.number:
        return [_xmlLeaf(field.key, _coerceNumber(rawValue, field.defaultValue).toString())];
      case FieldType.text:
        return [_xmlLeaf(field.key, rawValue?.toString() ?? field.defaultValue ?? '')];
    }
  }

  XmlElement _xmlLeaf(String key, String text) =>
      text.isEmpty ? XmlElement(XmlName(key)) : XmlElement(XmlName(key), const [], [XmlText(text)]);

  // ---------------------------------------------------------------------
  // Shared: generic Map/List tree (covers both JSON's native Map/List and
  // YamlMap/YamlList, since both implement Dart's Map/List interfaces).
  // ---------------------------------------------------------------------

  List<SchemaField> _fieldsFromMap(Map<dynamic, dynamic> map) {
    final fields = <SchemaField>[];
    for (final entry in map.entries) {
      fields.add(_fieldFromKeyValue(entry.key.toString(), entry.value));
    }
    return fields;
  }

  SchemaField _fieldFromKeyValue(String key, Object? value) {
    if (value is Map) {
      return SchemaField(key: key, type: FieldType.object, children: _fieldsFromMap(value));
    }
    if (value is List) {
      return _arrayFieldFromList(key, value);
    }
    return _leafField(key, value);
  }

  SchemaField _arrayFieldFromList(String key, List<dynamic> list) {
    if (list.isEmpty) {
      // Nothing to infer an item template from; documented limitation.
      return SchemaField(key: key, type: FieldType.array, children: const []);
    }
    final first = list.first;
    if (first is Map) {
      return SchemaField(key: key, type: FieldType.array, children: _fieldsFromMap(first));
    }
    return SchemaField(key: key, type: FieldType.array, children: [_leafField(scalarArrayItemKey, first)]);
  }

  SchemaField _leafField(String key, Object? value) =>
      SchemaField(key: key, type: _inferType(value), defaultValue: _stringify(value));

  FieldType _inferType(Object? raw) {
    if (raw is bool) return FieldType.boolean;
    if (raw is num) return FieldType.number;
    final text = raw?.toString() ?? '';
    if (_boolPattern.hasMatch(text)) return FieldType.boolean;
    if (_numberPattern.hasMatch(text)) return FieldType.number;
    return FieldType.text;
  }

  String _stringify(Object? raw) => raw?.toString() ?? '';

  bool _isScalarArrayTemplate(List<SchemaField> children) =>
      children.length == 1 && children.single.key == scalarArrayItemKey;

  Map<String, Object?> _mapFromFields(List<SchemaField> fields, Map<String, Object?> values) {
    final map = <String, Object?>{};
    for (final field in fields) {
      map[field.key] = _valueForField(field, values[field.key]);
    }
    return map;
  }

  Object? _valueForField(SchemaField field, Object? rawValue) {
    switch (field.type) {
      case FieldType.object:
        final itemValues = rawValue is Map ? Map<String, Object?>.from(rawValue) : <String, Object?>{};
        return _mapFromFields(field.children, itemValues);
      case FieldType.array:
        final items = rawValue is List ? rawValue : const [];
        if (_isScalarArrayTemplate(field.children)) {
          final itemField = field.children.single;
          return [for (final item in items) _valueForField(itemField, item is Map ? item[scalarArrayItemKey] : item)];
        }
        return [
          for (final item in items)
            _mapFromFields(field.children, item is Map ? Map<String, Object?>.from(item) : const {}),
        ];
      case FieldType.boolean:
        return _coerceBool(rawValue, field.defaultValue);
      case FieldType.number:
        return _coerceNumber(rawValue, field.defaultValue);
      case FieldType.text:
        return rawValue?.toString() ?? field.defaultValue ?? '';
    }
  }

  bool _coerceBool(Object? rawValue, String? fallback) {
    if (rawValue is bool) return rawValue;
    final text = rawValue?.toString() ?? fallback ?? 'false';
    return text.toLowerCase() == 'true';
  }

  num _coerceNumber(Object? rawValue, String? fallback) {
    if (rawValue is num) return rawValue;
    final text = rawValue?.toString() ?? fallback ?? '0';
    return num.tryParse(text) ?? 0;
  }
}
