import 'dart:convert';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import '../../../core/form_flow/formflow_parser.dart';
import '../../../core/form_flow/pdf_form_generator.dart';
import '../../../core/form_flow/schema_model.dart';
import '../../storage/schema_repository_factory.dart';
import '../shell/app_theme.dart';
import '../shell/file_drop_field.dart';
import '../shell/tool_detail_scaffold.dart';

/// FormFlow Dynamic Builder screen (spec Module 4 / Wireframe 3): one screen,
/// two panes.
///
/// Left ("SCHEMA DESIGNER & FIELD MAPPER"): paste raw XML/YAML/JSON, parse it
/// into a [FormFlowSchema] via [FormFlowParser], then reclassify any
/// detected field's [FieldType] live.
///
/// Right ("LIVE INTERACTIVE FORM & OUTPUT"): real input widgets generated
/// from the current schema — including a repeating card UI with
/// `[+ Add Item]`/remove for `array` ("Dynamic Array Loop") fields — with the
/// live-rendered output underneath, recomputed on every edit.
///
/// ## File input: paste box, not a file picker
/// The spec's "Upload File" affordance is implemented as a paste box + Parse
/// button rather than a native file picker. `file_selector` is not a
/// transitive dependency of this project (checked `pubspec.lock`; only
/// `xml`/`yaml`/`flutter_riverpod`/`go_router` were pre-installed for this
/// feature), and the task explicitly forbids adding new pubspec dependencies.
/// A multiline paste field works identically on desktop and web with zero
/// extra dependencies, so it's the reliable choice here.
class FormFlowBuilderScreen extends StatefulWidget {
  const FormFlowBuilderScreen({super.key, this.initialTemplate});

  /// Pre-loads a previously-saved template (see SavedTemplatesScreen's
  /// "Load" action, which routes here passing this via go_router's `extra`).
  final SavedFormFlowTemplate? initialTemplate;

  @override
  State<FormFlowBuilderScreen> createState() => _FormFlowBuilderScreenState();
}

class _FormFlowBuilderScreenState extends State<FormFlowBuilderScreen> {
  static const _parser = FormFlowParser();
  final _repository = createSchemaRepository();

  final _pasteController = TextEditingController();
  SourceFormat? _formatOverride;

  FormFlowSchema? _schema;
  String? _parseError;
  String? _templateName;
  String? _sourceFileName;
  String? _pdfStatus;
  bool _pdfWasError = false;

  @override
  void initState() {
    super.initState();
    final initial = widget.initialTemplate;
    if (initial != null) {
      _schema = initial.schema;
      _values = initial.values;
      _templateName = initial.name;
    }
  }

  /// Live form values. Mirrors the shape [FormFlowParser.render] expects:
  /// nested `Map<String, Object?>` for `object` fields, `List<Map<String,
  /// Object?>>` for `array` fields (one map per item), raw scalars for
  /// leaves. Mutated in place by the field widgets below and re-rendered on
  /// every change.
  Map<String, Object?> _values = {};

  @override
  void dispose() {
    _pasteController.dispose();
    super.dispose();
  }

  // -----------------------------------------------------------------------
  // Parse
  // -----------------------------------------------------------------------

  void _handleParse() {
    try {
      final schema = _parser.parse(_pasteController.text, formatHint: _formatOverride);
      setState(() {
        _schema = schema;
        _values = _defaultValues(schema.fields);
        _parseError = null;
      });
    } catch (e) {
      setState(() {
        _schema = null;
        _values = {};
        _parseError = _messageOf(e);
      });
    }
  }

  String _messageOf(Object e) {
    if (e is FormatException) return e.message;
    if (e is ArgumentError) return e.message?.toString() ?? e.toString();
    return e.toString();
  }

  /// Seeds a values tree from a field list's own detected defaults — used
  /// both to pre-fill the form right after parsing (one array item per
  /// `array` field, matching the "first occurrence" the template came from)
  /// and to build a fresh item when `[+ Add Item]` is pressed.
  Map<String, Object?> _defaultValues(List<SchemaField> fields) {
    final map = <String, Object?>{};
    for (final field in fields) {
      switch (field.type) {
        case FieldType.object:
          map[field.key] = _defaultValues(field.children);
        case FieldType.array:
          map[field.key] = field.children.isEmpty ? <Map<String, Object?>>[] : [_defaultValues(field.children)];
        case FieldType.boolean:
          map[field.key] = field.defaultValue?.toLowerCase() == 'true';
        case FieldType.number:
        case FieldType.text:
          map[field.key] = field.defaultValue ?? '';
      }
    }
    return map;
  }

  // -----------------------------------------------------------------------
  // Designer (left pane): field tree + FieldType reclassification
  // -----------------------------------------------------------------------

  /// Every retype is expressed as "replace this exact field with an updated
  /// copy" and bubbled up through nested closures — each recursion level
  /// knows how to rebuild *itself* with one updated child, so an edit at any
  /// depth correctly propagates all the way to a new [_schema] regardless of
  /// nesting.
  Widget _designerFieldRow(SchemaField field, void Function(SchemaField updated) onChanged, {int depth = 0}) {
    final isContainer = field.type == FieldType.object || field.type == FieldType.array;

    return Padding(
      padding: EdgeInsets.only(left: depth * 16.0, top: 6, bottom: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(field.key, style: const TextStyle(fontFamily: 'monospace', fontSize: 13)),
              ),
              DropdownButton<FieldType>(
                value: field.type,
                underline: const SizedBox.shrink(),
                items: [for (final t in FieldType.values) DropdownMenuItem(value: t, child: Text(t.label))],
                onChanged: (newType) {
                  if (newType == null || newType == field.type) return;
                  onChanged(_retypeField(field, newType));
                },
              ),
            ],
          ),
          if (isContainer)
            Row(
              children: [
                SizedBox(
                  height: 24,
                  width: 24,
                  child: Checkbox(
                    value: field.type == FieldType.array,
                    onChanged: (checked) {
                      final newType = (checked ?? false) ? FieldType.array : FieldType.object;
                      if (newType == field.type) return;
                      onChanged(field.copyWith(type: newType));
                    },
                  ),
                ),
                const SizedBox(width: 6),
                const Text('Mark as Dynamic Array Loop', style: TextStyle(fontSize: 12)),
              ],
            ),
          if (isContainer)
            for (var i = 0; i < field.children.length; i++)
              _designerFieldRow(
                field.children[i],
                (updatedChild) {
                  final newChildren = [...field.children];
                  newChildren[i] = updatedChild;
                  onChanged(field.copyWith(children: newChildren));
                },
                depth: depth + 1,
              ),
        ],
      ),
    );
  }

  /// Reclassifies [field] to [newType]. object<->array keep their children
  /// (same shape: a list of named sub-fields). Any other transition drops
  /// children (a leaf has none to invent) and keeps whatever defaultValue it
  /// already had, since [SchemaField.copyWith] cannot null out a value once
  /// set — a leftover default on a field now typed as object/array is inert
  /// (only `children` is read for those types).
  SchemaField _retypeField(SchemaField field, FieldType newType) {
    final wasContainer = field.type == FieldType.object || field.type == FieldType.array;
    final becomesContainer = newType == FieldType.object || newType == FieldType.array;
    if (wasContainer && becomesContainer) {
      return field.copyWith(type: newType);
    }
    if (becomesContainer) {
      return field.copyWith(type: newType, children: const []);
    }
    return field.copyWith(type: newType, defaultValue: field.defaultValue ?? '', children: const []);
  }

  void _replaceTopField(int index, SchemaField updated) {
    setState(() {
      final schema = _schema!;
      final fields = [...schema.fields];
      fields[index] = updated;
      _schema = FormFlowSchema(format: schema.format, rootName: schema.rootName, fields: fields);
    });
  }

  // -----------------------------------------------------------------------
  // Live form (right pane): real input widgets + [+ Add Item] arrays
  // -----------------------------------------------------------------------

  Map<String, Object?> _objectScope(Map<String, Object?> scope, String key) {
    final existing = scope[key];
    if (existing is Map<String, Object?>) return existing;
    final fresh = <String, Object?>{};
    scope[key] = fresh;
    return fresh;
  }

  List<Map<String, Object?>> _arrayScope(Map<String, Object?> scope, String key) {
    final existing = scope[key];
    final list = <Map<String, Object?>>[
      if (existing is List)
        for (final item in existing) item is Map<String, Object?> ? item : <String, Object?>{}
      // Retyping a field to `array` in the designer leaves the values tree
      // holding whatever shape it was parsed as. A Map means it was an
      // `object` a moment ago, so promote it to the array's first item
      // instead of discarding it — dropping it would blank the form (zero
      // item blocks, only a bare [+ Add Item]) and silently lose every
      // value the user had already filled in at that level.
      else if (existing is Map<String, Object?>)
        existing,
    ];
    scope[key] = list;
    return list;
  }

  bool _readBool(SchemaField field, Map<String, Object?> scope) {
    final raw = scope[field.key];
    if (raw is bool) return raw;
    final text = raw?.toString() ?? field.defaultValue ?? 'false';
    return text.toLowerCase() == 'true';
  }

  Widget _buildLiveForm(List<SchemaField> fields, Map<String, Object?> scope, VoidCallback onChanged) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final field in fields) ...[
          _liveFieldWidget(field, scope, onChanged),
          const SizedBox(height: 10),
        ],
      ],
    );
  }

  Widget _liveFieldWidget(SchemaField field, Map<String, Object?> scope, VoidCallback onChanged) {
    switch (field.type) {
      case FieldType.text:
        return _ScalarValueField(
          key: ValueKey('text_${field.key}'),
          field: field,
          scope: scope,
          onChanged: onChanged,
        );
      case FieldType.number:
        return _ScalarValueField(
          key: ValueKey('number_${field.key}'),
          field: field,
          scope: scope,
          onChanged: onChanged,
          numeric: true,
        );
      case FieldType.boolean:
        return SwitchListTile(
          contentPadding: EdgeInsets.zero,
          dense: true,
          title: Text(field.displayLabel),
          value: _readBool(field, scope),
          onChanged: (v) {
            scope[field.key] = v;
            onChanged();
          },
        );
      case FieldType.object:
        final childScope = _objectScope(scope, field.key);
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(field.displayLabel, style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 8),
                _buildLiveForm(field.children, childScope, onChanged),
              ],
            ),
          ),
        );
      case FieldType.array:
        return _buildArrayField(field, scope, onChanged);
    }
  }

  Widget _buildArrayField(SchemaField field, Map<String, Object?> scope, VoidCallback onChanged) {
    final items = _arrayScope(scope, field.key);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${field.displayLabel} — Dynamic Array Loop', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            for (final item in items)
              Padding(
                key: ObjectKey(item),
                padding: const EdgeInsets.only(bottom: 8),
                child: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: _buildLiveForm(field.children, item, onChanged)),
                      IconButton(
                        tooltip: 'Remove item',
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () {
                          items.remove(item);
                          onChanged();
                        },
                      ),
                    ],
                  ),
                ),
              ),
            OutlinedButton.icon(
              icon: const Icon(Icons.add),
              label: const Text('Add Item'),
              onPressed: () {
                items.add(_defaultValues(field.children));
                onChanged();
              },
            ),
          ],
        ),
      ),
    );
  }

  // -----------------------------------------------------------------------
  // Save (persists through ISchemaRepository, shared with SavedTemplatesScreen)
  // -----------------------------------------------------------------------

  /// Loads a dropped/browsed source file into the paste box and parses it
  /// immediately — same code path as pasting, just sourced from a file.
  void _handleFilePicked(List<PickedFileData> files) {
    final file = files.first;
    try {
      _pasteController.text = utf8.decode(file.bytes);
      _sourceFileName = file.name;
      _handleParse();
    } on FormatException {
      setState(() {
        _schema = null;
        _parseError = '"${file.name}" is not valid UTF-8 text — XML, YAML and JSON sources must be text files.';
      });
    }
  }

  Future<void> _handleExportPdf() async {
    final schema = _schema;
    if (schema == null) return;

    setState(() => _pdfStatus = null);
    try {
      final bytes = await const PdfFormGenerator().generate(schema, values: _values, title: _templateName);
      final savedTo = await saveBytesWithDialog(
        bytes: bytes,
        suggestedName: '${_templateName ?? schema.rootName}-form.pdf',
        mimeType: 'application/pdf',
        acceptedTypes: const [XTypeGroup(label: 'PDF', extensions: ['pdf'])],
      );
      if (!mounted) return;
      setState(() {
        _pdfWasError = false;
        _pdfStatus = savedTo == null ? 'Export cancelled.' : 'Fillable PDF saved to $savedTo';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _pdfWasError = true;
        _pdfStatus = 'Could not export PDF: ${_messageOf(e)}';
      });
    }
  }

  Future<void> _handleSaveTemplate() async {
    final schema = _schema;
    if (schema == null) return;

    final nameController = TextEditingController(text: _templateName ?? '');
    final name = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Save template'),
        content: TextField(
          controller: nameController,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Template name', border: OutlineInputBorder()),
          onSubmitted: (value) => Navigator.of(dialogContext).pop(value.trim()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(nameController.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    nameController.dispose();

    if (name == null || name.isEmpty) return;

    final template = SavedFormFlowTemplate(name: name, schema: schema, values: _values);
    await _repository.save(name, jsonEncode(template.toJson()));
    if (!mounted) return;

    setState(() => _templateName = name);
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('Saved "$name"')));
  }

  // -----------------------------------------------------------------------
  // Output
  // -----------------------------------------------------------------------

  ({String? output, String? error}) _computeOutput() {
    final schema = _schema;
    if (schema == null) return (output: null, error: null);
    try {
      return (output: _parser.render(schema, _values), error: null);
    } catch (e) {
      return (output: null, error: _messageOf(e));
    }
  }

  // -----------------------------------------------------------------------
  // Build
  // -----------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final computed = _computeOutput();
    return ToolDetailScaffold(
      title: 'FormFlow Builder',
      copyText: computed.output,
      inputPanel: _buildDesignerPanel(context),
      outputPanel: _buildRunnerPanel(context, computed),
    );
  }

  Widget _buildDesignerPanel(BuildContext context) {
    final schema = _schema;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Upload File', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 4),
        Text(
          'Drop an XML, YAML or JSON file below — or paste its contents directly.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 8),
        FileDropField(
          onFilesPicked: _handleFilePicked,
          acceptedTypes: const [
            XTypeGroup(label: 'Structured data', extensions: ['xml', 'yaml', 'yml', 'json']),
          ],
          hint: 'XML, YAML or JSON',
          loadedSummary: _sourceFileName,
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _pasteController,
          maxLines: 10,
          minLines: 6,
          style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: '<config>\n  <server>...</server>\n</config>',
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: DropdownButton<SourceFormat?>(
                isExpanded: true,
                value: _formatOverride,
                items: [
                  const DropdownMenuItem<SourceFormat?>(value: null, child: Text('Auto-detect format')),
                  for (final f in SourceFormat.values) DropdownMenuItem(value: f, child: Text(f.label)),
                ],
                onChanged: (value) => setState(() => _formatOverride = value),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton(onPressed: _handleParse, child: const Text('Parse')),
          ],
        ),
        if (_parseError != null) ...[
          const SizedBox(height: 8),
          Text(
            'Could not parse: $_parseError',
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
        if (schema != null) ...[
          const SizedBox(height: 20),
          const Divider(),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text('SCHEMA DESIGNER & FIELD MAPPER', style: Theme.of(context).textTheme.titleSmall),
              ),
              OutlinedButton.icon(
                icon: const Icon(Icons.save_outlined, size: 16),
                label: const Text('Save Template'),
                onPressed: _handleSaveTemplate,
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                icon: const Icon(Icons.picture_as_pdf_outlined, size: 16),
                label: const Text('Export PDF'),
                onPressed: _handleExportPdf,
              ),
            ],
          ),
          if (_pdfStatus != null) ...[
            const SizedBox(height: 8),
            Text(
              _pdfStatus!,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: _pdfWasError ? Theme.of(context).colorScheme.error : Theme.of(context).colorScheme.primary,
              ),
            ),
          ],
          const SizedBox(height: 4),
          Text(
            _templateName != null
                ? 'Detected root "${schema.rootName}" (${schema.format.label}) · Saved as "$_templateName"'
                : 'Detected root "${schema.rootName}" (${schema.format.label})',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          for (var i = 0; i < schema.fields.length; i++)
            _designerFieldRow(schema.fields[i], (updated) => _replaceTopField(i, updated)),
        ],
      ],
    );
  }

  Widget _buildRunnerPanel(BuildContext context, ({String? output, String? error}) computed) {
    final schema = _schema;
    if (schema == null) {
      return const Text('Parse a file on the left to see the live interactive form here.');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('LIVE INTERACTIVE FORM', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 12),
        _buildLiveForm(schema.fields, _values, () => setState(() {})),
        const SizedBox(height: 12),
        const Divider(),
        const SizedBox(height: 12),
        Text('GENERATED OUTPUT', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 8),
        if (computed.error != null)
          Text(
            'Could not render: ${computed.error}',
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          )
        else
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
              borderRadius: BorderRadius.circular(8),
            ),
            child: SelectableText(computed.output ?? '', style: AppTheme.monospace),
          ),
      ],
    );
  }
}

/// A single leaf text/number input, backed by its own [TextEditingController]
/// so typing survives the parent's `setState` rebuilds (every keystroke
/// re-renders the output panel, which would otherwise reset the controller
/// and jump the cursor if it were built inline in a stateless method). Writes
/// straight into the shared mutable [scope] map on every change.
class _ScalarValueField extends StatefulWidget {
  const _ScalarValueField({
    super.key,
    required this.field,
    required this.scope,
    required this.onChanged,
    this.numeric = false,
  });

  final SchemaField field;
  final Map<String, Object?> scope;
  final VoidCallback onChanged;
  final bool numeric;

  @override
  State<_ScalarValueField> createState() => _ScalarValueFieldState();
}

class _ScalarValueFieldState extends State<_ScalarValueField> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    final initial = widget.scope[widget.field.key]?.toString() ?? widget.field.defaultValue ?? '';
    widget.scope[widget.field.key] = initial;
    _controller = TextEditingController(text: initial);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      keyboardType: widget.numeric ? TextInputType.number : TextInputType.text,
      decoration: InputDecoration(
        labelText: widget.field.displayLabel,
        border: const OutlineInputBorder(),
        isDense: true,
      ),
      onChanged: (value) {
        widget.scope[widget.field.key] = value;
        widget.onChanged();
      },
    );
  }
}
