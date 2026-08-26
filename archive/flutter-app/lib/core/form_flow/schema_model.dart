/// FormFlow's shared data model — the frozen contract between the parsing
/// engine, the designer/runner UI, and the template storage layer, so all
/// three can be built independently against a stable shape.
library;

enum SourceFormat {
  xml,
  yaml,
  json;

  String get label => switch (this) {
    SourceFormat.xml => 'XML',
    SourceFormat.yaml => 'YAML',
    SourceFormat.json => 'JSON',
  };
}

enum FieldType {
  text,
  number,
  boolean,
  /// A non-repeating nested group (children rendered inline, once).
  object,
  /// A repeating group (spec's "Dynamic Array Loop") — children describe
  /// one item's shape; the form runner renders N copies via [+ Add Item].
  array;

  String get label => switch (this) {
    FieldType.text => 'Text Input',
    FieldType.number => 'Number Input',
    FieldType.boolean => 'Switch Toggle',
    FieldType.object => 'Group',
    FieldType.array => 'Dynamic Array Loop',
  };
}

/// One detected node in the source file: a leaf (text/number/boolean) or a
/// container (object/array) with [children] describing its shape. For an
/// `array` field, [children] is the per-item template — the form runner
/// clones it once per array entry.
class SchemaField {
  const SchemaField({
    required this.key,
    required this.type,
    this.label,
    this.defaultValue,
    this.children = const [],
  });

  /// Tag/property name as it appears in the source file.
  final String key;
  final FieldType type;

  /// Display label; falls back to [key] when null.
  final String? label;

  /// Only meaningful for scalar leaf types (text/number/boolean).
  final String? defaultValue;

  /// Sub-fields for object/array types; empty for scalar leaves.
  final List<SchemaField> children;

  String get displayLabel => label ?? key;

  Map<String, Object?> toJson() => {
    'key': key,
    'type': type.name,
    if (label != null) 'label': label,
    if (defaultValue != null) 'defaultValue': defaultValue,
    if (children.isNotEmpty) 'children': [for (final c in children) c.toJson()],
  };

  factory SchemaField.fromJson(Map<String, Object?> json) => SchemaField(
    key: json['key'] as String,
    type: FieldType.values.byName(json['type'] as String),
    label: json['label'] as String?,
    defaultValue: json['defaultValue'] as String?,
    children: [
      for (final c in (json['children'] as List<Object?>? ?? const []))
        SchemaField.fromJson(c as Map<String, Object?>),
    ],
  );

  SchemaField copyWith({String? key, FieldType? type, String? label, String? defaultValue, List<SchemaField>? children}) =>
      SchemaField(
        key: key ?? this.key,
        type: type ?? this.type,
        label: label ?? this.label,
        defaultValue: defaultValue ?? this.defaultValue,
        children: children ?? this.children,
      );
}

/// A fully-detected schema for one uploaded file: its source format (needed
/// to know how to re-serialize), the root element's tag/name (XML/JSON need
/// a wrapping root; YAML doesn't), and the top-level fields.
class FormFlowSchema {
  const FormFlowSchema({required this.format, required this.rootName, required this.fields});

  final SourceFormat format;

  /// Root tag name for XML (e.g. "config"), or a display name for YAML/JSON
  /// where there's no single root tag.
  final String rootName;
  final List<SchemaField> fields;

  Map<String, Object?> toJson() => {
    'format': format.name,
    'rootName': rootName,
    'fields': [for (final f in fields) f.toJson()],
  };

  factory FormFlowSchema.fromJson(Map<String, Object?> json) => FormFlowSchema(
    format: SourceFormat.values.byName(json['format'] as String),
    rootName: json['rootName'] as String,
    fields: [for (final f in (json['fields'] as List<Object?>)) SchemaField.fromJson(f as Map<String, Object?>)],
  );
}

/// A named, saved FormFlow template (spec: "Sidebar Template Library") —
/// the schema plus whatever values the user had filled in when they saved
/// it, so reopening it restores the form as they left it.
class SavedFormFlowTemplate {
  const SavedFormFlowTemplate({required this.name, required this.schema, required this.values});

  final String name;
  final FormFlowSchema schema;
  final Map<String, Object?> values;

  Map<String, Object?> toJson() => {'name': name, 'schema': schema.toJson(), 'values': values};

  factory SavedFormFlowTemplate.fromJson(Map<String, Object?> json) => SavedFormFlowTemplate(
    name: json['name'] as String,
    schema: FormFlowSchema.fromJson(json['schema'] as Map<String, Object?>),
    values: json['values'] as Map<String, Object?>,
  );
}
