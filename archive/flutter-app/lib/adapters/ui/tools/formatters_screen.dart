import 'package:flutter/material.dart';

import '../../../core/utility/json_formatter.dart';
import '../../../core/utility/sql_formatter.dart';
import '../../../core/utility/xml_formatter.dart';
import '../../../core/utility/yaml_formatter.dart';
import '../shell/tool_detail_scaffold.dart';

enum _FormatKind { json, xml, yaml, sql }

enum _Mode { pretty, minify, validate }

class FormattersScreen extends StatefulWidget {
  const FormattersScreen({super.key});

  @override
  State<FormattersScreen> createState() => _FormattersScreenState();
}

class _FormattersScreenState extends State<FormattersScreen> {
  static const _jsonFormatter = JsonFormatter();
  static const _xmlFormatter = XmlFormatter();
  static const _yamlFormatter = YamlFormatter();
  static const _sqlFormatter = SqlFormatter();

  final _controller = TextEditingController();
  _FormatKind _format = _FormatKind.json;
  _Mode _mode = _Mode.pretty;

  bool _isValid = true;
  String _output = '';
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_recompute);
    _recompute();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _recompute() {
    final source = _controller.text;
    try {
      final (isValid, output, error) = switch (_format) {
        _FormatKind.json => _jsonResult(source),
        _FormatKind.xml => _xmlResult(source),
        _FormatKind.yaml => _yamlResult(source),
        _FormatKind.sql => _sqlResult(source),
      };
      _apply(isValid, output, error);
    } catch (e) {
      _apply(false, null, 'Unexpected error: $e');
    }
  }

  (bool, String?, String?) _jsonResult(String source) {
    final result = _jsonFormatter.execute(JsonFormatterInput(source: source, mode: _jsonMode()));
    return (result.isValid, result.output, result.errorMessage);
  }

  (bool, String?, String?) _xmlResult(String source) {
    final result = _xmlFormatter.execute(XmlFormatterInput(source: source, mode: _xmlMode()));
    return (result.isValid, result.output, result.errorMessage);
  }

  (bool, String?, String?) _yamlResult(String source) {
    final result = _yamlFormatter.execute(YamlFormatterInput(source: source, mode: _yamlMode()));
    return (result.isValid, result.output, result.errorMessage);
  }

  (bool, String?, String?) _sqlResult(String source) {
    final result = _sqlFormatter.execute(SqlFormatterInput(source: source, mode: _sqlMode()));
    return (result.isValid, result.output, result.errorMessage);
  }

  JsonFormatMode _jsonMode() => switch (_mode) {
        _Mode.pretty => JsonFormatMode.pretty,
        _Mode.minify => JsonFormatMode.minify,
        _Mode.validate => JsonFormatMode.validate,
      };

  XmlFormatMode _xmlMode() => switch (_mode) {
        _Mode.pretty => XmlFormatMode.pretty,
        _Mode.minify => XmlFormatMode.minify,
        _Mode.validate => XmlFormatMode.validate,
      };

  YamlFormatMode _yamlMode() => switch (_mode) {
        _Mode.pretty => YamlFormatMode.pretty,
        _Mode.minify => YamlFormatMode.minify,
        _Mode.validate => YamlFormatMode.validate,
      };

  SqlFormatMode _sqlMode() => switch (_mode) {
        _Mode.pretty => SqlFormatMode.pretty,
        _Mode.minify => SqlFormatMode.minify,
        _Mode.validate => SqlFormatMode.validate,
      };

  void _apply(bool isValid, String? output, String? error) {
    setState(() {
      _isValid = isValid;
      _output = output ?? '';
      _error = error;
    });
  }

  String _formatLabel() => switch (_format) {
        _FormatKind.json => 'JSON',
        _FormatKind.xml => 'XML',
        _FormatKind.yaml => 'YAML',
        _FormatKind.sql => 'SQL',
      };

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'Formatters',
      copyText: _isValid && _output.isNotEmpty ? _output : null,
      inputPanel: _buildInputPanel(context),
      outputPanel: _buildOutputPanel(context),
    );
  }

  Widget _buildInputPanel(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Input', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        SegmentedButton<_FormatKind>(
          segments: const [
            ButtonSegment(value: _FormatKind.json, label: Text('JSON')),
            ButtonSegment(value: _FormatKind.xml, label: Text('XML')),
            ButtonSegment(value: _FormatKind.yaml, label: Text('YAML')),
            ButtonSegment(value: _FormatKind.sql, label: Text('SQL')),
          ],
          selected: {_format},
          onSelectionChanged: (selection) {
            setState(() => _format = selection.first);
            _recompute();
          },
        ),
        const SizedBox(height: 8),
        SegmentedButton<_Mode>(
          segments: const [
            ButtonSegment(value: _Mode.pretty, label: Text('Pretty')),
            ButtonSegment(value: _Mode.minify, label: Text('Minify')),
            ButtonSegment(value: _Mode.validate, label: Text('Validate')),
          ],
          selected: {_mode},
          onSelectionChanged: (selection) {
            setState(() => _mode = selection.first);
            _recompute();
          },
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _controller,
          maxLines: 16,
          minLines: 8,
          style: const TextStyle(fontFamily: 'monospace'),
          decoration: InputDecoration(
            border: const OutlineInputBorder(),
            hintText: 'Paste ${_formatLabel()} here',
          ),
        ),
      ],
    );
  }

  Widget _buildOutputPanel(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(
              _isValid ? Icons.check_circle : Icons.error,
              color: _isValid ? Colors.green : theme.colorScheme.error,
            ),
            const SizedBox(width: 8),
            Text(
              _isValid ? 'Valid ${_formatLabel()}' : 'Invalid ${_formatLabel()}',
              style: theme.textTheme.titleMedium,
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (!_isValid && _error != null)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.colorScheme.errorContainer,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(_error!, style: TextStyle(color: theme.colorScheme.onErrorContainer)),
          )
        else
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              border: Border.all(color: theme.dividerColor),
              borderRadius: BorderRadius.circular(8),
            ),
            child: SelectableText(
              _output.isEmpty ? '(no output)' : _output,
              style: const TextStyle(fontFamily: 'monospace'),
            ),
          ),
      ],
    );
  }
}
