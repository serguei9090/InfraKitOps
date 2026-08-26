import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/form_flow/formflow_parser.dart';
import 'package:infrakit_studio/core/form_flow/schema_model.dart';

/// Builds a values map (matching the contract documented on
/// [FormFlowParser.render]: array values are `List<Map<String, Object?>>`,
/// one map per item) from a schema's own detected defaults — i.e. "the user
/// submitted the form without changing anything". Each array gets exactly
/// one item, built from its child template's defaults.
Map<String, Object?> _valuesFromDefaults(List<SchemaField> fields) {
  final values = <String, Object?>{};
  for (final field in fields) {
    switch (field.type) {
      case FieldType.object:
        values[field.key] = _valuesFromDefaults(field.children);
      case FieldType.array:
        values[field.key] = [_valuesFromDefaults(field.children)];
      case FieldType.text:
      case FieldType.number:
      case FieldType.boolean:
        values[field.key] = field.defaultValue;
    }
  }
  return values;
}

/// Canonical, comparable snapshot of a field tree's shape + data, via the
/// schema model's own toJson() (ignores nothing but is stable/deep).
List<Map<String, Object?>> _snapshot(List<SchemaField> fields) => [for (final f in fields) f.toJson()];

void main() {
  const parser = FormFlowParser();

  group('XML', () {
    const xml = '''
<config>
  <enabled>true</enabled>
  <name>prod-cluster</name>
  <server>
    <host>10.0.0.1</host>
    <port>8080</port>
  </server>
  <server>
    <host>10.0.0.2</host>
    <port>8081</port>
  </server>
  <admin>alice</admin>
  <admin>bob</admin>
</config>
''';

    test('detects format and root name', () {
      final schema = parser.parse(xml);
      expect(schema.format, SourceFormat.xml);
      expect(schema.rootName, 'config');
    });

    test('detects a boolean leaf, a text leaf, and a repeated object group', () {
      final schema = parser.parse(xml);
      final byKey = {for (final f in schema.fields) f.key: f};

      expect(byKey['enabled']!.type, FieldType.boolean);
      expect(byKey['enabled']!.defaultValue, 'true');

      expect(byKey['name']!.type, FieldType.text);
      expect(byKey['name']!.defaultValue, 'prod-cluster');

      final server = byKey['server']!;
      expect(server.type, FieldType.array);
      expect(server.children.map((c) => c.key), ['host', 'port']);
      expect(server.children.firstWhere((c) => c.key == 'host').type, FieldType.text);
      expect(server.children.firstWhere((c) => c.key == 'host').defaultValue, '10.0.0.1');
      expect(server.children.firstWhere((c) => c.key == 'port').type, FieldType.number);
      expect(server.children.firstWhere((c) => c.key == 'port').defaultValue, '8080');
    });

    test('detects a repeated scalar sibling as an array with a synthetic value child', () {
      final schema = parser.parse(xml);
      final admin = schema.fields.firstWhere((f) => f.key == 'admin');

      expect(admin.type, FieldType.array);
      expect(admin.children, hasLength(1));
      expect(admin.children.single.key, scalarArrayItemKey);
      expect(admin.children.single.type, FieldType.text);
      expect(admin.children.single.defaultValue, 'alice');
    });

    test('rejects malformed XML', () {
      expect(() => parser.parse('<unclosed>', formatHint: SourceFormat.xml), throwsA(isA<Object>()));
    });
  });

  group('YAML', () {
    const yaml = '''
enabled: true
name: prod-cluster
server:
  - host: 10.0.0.1
    port: 8080
  - host: 10.0.0.2
    port: 8081
admin:
  - alice
  - bob
''';

    test('detects format and the equivalent field shape as XML', () {
      final schema = parser.parse(yaml);
      expect(schema.format, SourceFormat.yaml);

      final byKey = {for (final f in schema.fields) f.key: f};
      expect(byKey['enabled']!.type, FieldType.boolean);
      expect(byKey['name']!.type, FieldType.text);

      final server = byKey['server']!;
      expect(server.type, FieldType.array);
      expect(server.children.map((c) => c.key), ['host', 'port']);
      expect(server.children.firstWhere((c) => c.key == 'port').type, FieldType.number);

      final admin = byKey['admin']!;
      expect(admin.type, FieldType.array);
      expect(admin.children.single.key, scalarArrayItemKey);
      expect(admin.children.single.defaultValue, 'alice');
    });
  });

  group('JSON', () {
    const json = '''
{
  "enabled": true,
  "name": "prod-cluster",
  "server": [
    {"host": "10.0.0.1", "port": 8080},
    {"host": "10.0.0.2", "port": 8081}
  ],
  "admin": ["alice", "bob"]
}
''';

    test('detects format and the equivalent field shape as XML/YAML', () {
      final schema = parser.parse(json);
      expect(schema.format, SourceFormat.json);

      final byKey = {for (final f in schema.fields) f.key: f};
      expect(byKey['enabled']!.type, FieldType.boolean);
      expect(byKey['name']!.type, FieldType.text);

      final server = byKey['server']!;
      expect(server.type, FieldType.array);
      expect(server.children.map((c) => c.key), ['host', 'port']);
      expect(server.children.firstWhere((c) => c.key == 'port').type, FieldType.number);

      final admin = byKey['admin']!;
      expect(admin.type, FieldType.array);
      expect(admin.children.single.key, scalarArrayItemKey);
    });
  });

  group('round trip (render re-parses to the same data)', () {
    test('XML: parse -> render -> re-parse yields the same field shape and data', () {
      const xml = '''
<config>
  <enabled>true</enabled>
  <name>prod-cluster</name>
  <server>
    <host>10.0.0.1</host>
    <port>8080</port>
  </server>
  <admin>alice</admin>
</config>
''';
      final schema1 = parser.parse(xml);
      final values = _valuesFromDefaults(schema1.fields);
      final rendered = parser.render(schema1, values);

      // Re-parsed output should itself be valid, well-formed XML.
      expect(rendered.contains('<config'), isTrue);

      final schema2 = parser.parse(rendered, formatHint: SourceFormat.xml);
      expect(_snapshot(schema2.fields), equals(_snapshot(schema1.fields)));
    });

    test('YAML: parse -> render -> re-parse yields the same field shape and data', () {
      const yaml = '''
enabled: true
name: prod-cluster
server:
  - host: 10.0.0.1
    port: 8080
admin:
  - alice
''';
      final schema1 = parser.parse(yaml);
      final values = _valuesFromDefaults(schema1.fields);
      final rendered = parser.render(schema1, values);

      final schema2 = parser.parse(rendered, formatHint: SourceFormat.yaml);
      expect(_snapshot(schema2.fields), equals(_snapshot(schema1.fields)));
    });

    test('JSON: parse -> render -> re-parse yields the same field shape and data', () {
      const json = '''
{
  "enabled": true,
  "name": "prod-cluster",
  "server": [{"host": "10.0.0.1", "port": 8080}],
  "admin": ["alice"]
}
''';
      final schema1 = parser.parse(json);
      final values = _valuesFromDefaults(schema1.fields);
      final rendered = parser.render(schema1, values);

      final schema2 = parser.parse(rendered, formatHint: SourceFormat.json);
      expect(_snapshot(schema2.fields), equals(_snapshot(schema1.fields)));
    });
  });

  group('format auto-detection', () {
    test('picks JSON over XML/YAML for a JSON object', () {
      final schema = parser.parse('{"a": 1}');
      expect(schema.format, SourceFormat.json);
    });

    test('picks XML for an XML document', () {
      final schema = parser.parse('<root><a>1</a></root>');
      expect(schema.format, SourceFormat.xml);
    });

    test('picks YAML for a plain mapping', () {
      final schema = parser.parse('a: 1\nb: two\n');
      expect(schema.format, SourceFormat.yaml);
    });

    test('throws a clear error when nothing matches', () {
      expect(() => parser.parse('***not a config file***'), throwsA(isA<FormatException>()));
    });
  });
}
