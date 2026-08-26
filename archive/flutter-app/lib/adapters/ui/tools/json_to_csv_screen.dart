import 'dart:convert';
import 'dart:typed_data';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import '../../../core/utility/json_to_csv.dart';
import '../shell/app_theme.dart';
import '../shell/file_drop_field.dart';
import '../shell/tool_detail_scaffold.dart';

/// "JSON to CSV Converter" tool screen.
///
/// JSON array-of-objects text goes in on the left; RFC 4180 CSV text comes
/// out on the right, live, with the delimiter/line-ending/array-handling
/// options the core supports exposed as controls. The result is copyable
/// via the scaffold's toolbar action and saveable as a `.csv` file.
class JsonToCsvScreen extends StatefulWidget {
  const JsonToCsvScreen({super.key});

  @override
  State<JsonToCsvScreen> createState() => _JsonToCsvScreenState();
}

class _JsonToCsvScreenState extends State<JsonToCsvScreen> {
  static const _converter = JsonToCsvConverter();

  final _controller = TextEditingController();

  CsvDelimiter _delimiter = CsvDelimiter.comma;
  CsvLineEnding _lineEnding = CsvLineEnding.crlf;
  CsvArrayHandling _arrayHandling = CsvArrayHandling.indexedColumns;
  bool _includeHeader = true;

  JsonToCsvResult? _result;
  String? _error;

  String? _saveStatus;
  bool _saveWasError = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_recompute);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _recompute() {
    final source = _controller.text;
    if (source.trim().isEmpty) {
      setState(() {
        _result = null;
        _error = null;
      });
      return;
    }
    try {
      final result = _converter.execute(
        JsonToCsvInput(
          json: source,
          delimiter: _delimiter,
          lineEnding: _lineEnding,
          arrayHandling: _arrayHandling,
          includeHeader: _includeHeader,
        ),
      );
      setState(() {
        _result = result;
        _error = null;
      });
    } catch (e) {
      setState(() {
        _result = null;
        _error = _describeError(e);
      });
    }
  }

  void _setOption(VoidCallback update) {
    setState(update);
    _recompute();
  }

  Future<void> _onSamplePicked(List<PickedFileData> files) async {
    try {
      final text = utf8.decode(files.first.bytes);
      setState(() => _controller.text = text);
      _recompute();
    } catch (e) {
      setState(() {
        _result = null;
        _error = 'Could not read file as UTF-8 text: $e';
      });
    }
  }

  Future<void> _save() async {
    final result = _result;
    if (result == null) {
      setState(() {
        _saveWasError = true;
        _saveStatus = 'Convert some JSON first.';
      });
      return;
    }
    try {
      final savedTo = await saveBytesWithDialog(
        bytes: Uint8List.fromList(utf8.encode(result.csv)),
        suggestedName: 'output.csv',
        mimeType: 'text/csv',
        acceptedTypes: const [
          XTypeGroup(label: 'CSV', extensions: ['csv']),
        ],
      );
      if (!mounted) return;
      setState(() {
        _saveWasError = false;
        _saveStatus =
            savedTo == null ? 'Save cancelled — nothing was written.' : 'Saved ${result.rowCount} rows to $savedTo';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saveWasError = true;
        _saveStatus = 'Could not save file: $e';
      });
    }
  }

  String _describeError(Object e) {
    if (e is FormatException) return e.message;
    if (e is ArgumentError) return e.message?.toString() ?? e.toString();
    return e.toString();
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'JSON to CSV Converter',
      copyText: _result?.csv,
      inputPanel: _buildInputPanel(context),
      outputPanel: _buildOutputPanel(context),
    );
  }

  Widget _buildInputPanel(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('JSON input', style: textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _controller,
          maxLines: 14,
          minLines: 8,
          style: AppTheme.monospace,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: '[{"a": 1, "b": 2}, {"a": 3, "b": 4}]',
          ),
        ),
        const SizedBox(height: 8),
        FileDropField(
          onFilesPicked: _onSamplePicked,
          acceptedTypes: const [
            XTypeGroup(label: 'JSON', extensions: ['json']),
          ],
          hint: 'Optional: load a .json file instead of pasting',
        ),
        const SizedBox(height: 20),
        Text('Delimiter', style: textTheme.titleMedium),
        const SizedBox(height: 8),
        SegmentedButton<CsvDelimiter>(
          segments: const [
            ButtonSegment(value: CsvDelimiter.comma, label: Text('Comma')),
            ButtonSegment(value: CsvDelimiter.semicolon, label: Text('Semicolon')),
            ButtonSegment(value: CsvDelimiter.tab, label: Text('Tab')),
          ],
          selected: {_delimiter},
          onSelectionChanged: (selection) => _setOption(() => _delimiter = selection.first),
        ),
        const SizedBox(height: 16),
        Text('Line ending', style: textTheme.titleMedium),
        const SizedBox(height: 8),
        SegmentedButton<CsvLineEnding>(
          segments: const [
            ButtonSegment(value: CsvLineEnding.crlf, label: Text('CRLF')),
            ButtonSegment(value: CsvLineEnding.lf, label: Text('LF')),
          ],
          selected: {_lineEnding},
          onSelectionChanged: (selection) => _setOption(() => _lineEnding = selection.first),
        ),
        const SizedBox(height: 16),
        Text('Nested arrays', style: textTheme.titleMedium),
        const SizedBox(height: 8),
        SegmentedButton<CsvArrayHandling>(
          segments: const [
            ButtonSegment(value: CsvArrayHandling.indexedColumns, label: Text('Indexed columns')),
            ButtonSegment(value: CsvArrayHandling.jsonEncoded, label: Text('JSON in cell')),
          ],
          selected: {_arrayHandling},
          onSelectionChanged: (selection) => _setOption(() => _arrayHandling = selection.first),
        ),
        const SizedBox(height: 12),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Include header row'),
          value: _includeHeader,
          onChanged: (value) => _setOption(() => _includeHeader = value),
        ),
      ],
    );
  }

  Widget _buildOutputPanel(BuildContext context) {
    if (_error != null) return _errorBanner(context, _error!);

    final result = _result;
    if (result == null) {
      return const Text('Paste a JSON array of objects on the left to see the CSV here.');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _statRow(context, 'Columns', '${result.headers.length}'),
        _statRow(context, 'Rows', '${result.rowCount}'),
        const SizedBox(height: 12),
        Container(
          width: double.infinity,
          constraints: const BoxConstraints(maxHeight: 320),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            border: Border.all(color: Theme.of(context).dividerColor),
            borderRadius: BorderRadius.circular(8),
          ),
          child: SingleChildScrollView(
            child: SelectableText(result.csv.isEmpty ? '(no output)' : result.csv, style: AppTheme.monospace),
          ),
        ),
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: _save,
          icon: const Icon(Icons.save_outlined),
          label: const Text('Save as .csv…'),
        ),
        if (_saveStatus != null) ...[
          const SizedBox(height: 8),
          _saveWasError ? _errorBanner(context, _saveStatus!) : _successBanner(context, _saveStatus!),
        ],
      ],
    );
  }

  Widget _statRow(BuildContext context, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodyMedium),
          Text(value, style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  Widget _errorBanner(BuildContext context, String message) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.error_outline, color: scheme.onErrorContainer),
            const SizedBox(width: 8),
            Expanded(child: Text(message, style: TextStyle(color: scheme.onErrorContainer))),
          ],
        ),
      ),
    );
  }

  Widget _successBanner(BuildContext context, String message) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.tertiaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.check_circle_outline, color: scheme.onTertiaryContainer),
            const SizedBox(width: 8),
            Expanded(child: Text(message, style: TextStyle(color: scheme.onTertiaryContainer))),
          ],
        ),
      ),
    );
  }
}
