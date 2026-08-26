import 'package:flutter/material.dart';

import '../../../core/utility/text_transformer.dart';
import '../shell/app_theme.dart';
import '../shell/tool_detail_scaffold.dart';

/// "Text Case / Slug / Line Tools" tool screen.
///
/// One operation picker, grouped into the three families the core exposes
/// (Case / Slugify / Lines) so eighteen-odd operations don't turn into one
/// giant flat list. Whichever family is selected shows only the options
/// relevant to it; everything recomputes live as the source text or any
/// option changes.
enum _Category { caseConversion, slugify, lines }

class TextTransformerScreen extends StatefulWidget {
  const TextTransformerScreen({super.key});

  @override
  State<TextTransformerScreen> createState() => _TextTransformerScreenState();
}

class _TextTransformerScreenState extends State<TextTransformerScreen> {
  static const _transformer = TextTransformer();

  final _textController = TextEditingController();
  final _separatorController = TextEditingController(text: '-');
  final _maxLengthController = TextEditingController();
  final _numberStartController = TextEditingController(text: '1');
  final _numberSeparatorController = TextEditingController(text: '. ');

  _Category _category = _Category.caseConversion;
  TextCase _targetCase = TextCase.camel;
  LineOperation _lineOperation = LineOperation.sort;

  bool _slugLowercase = true;
  bool _sortDescending = false;
  bool _caseInsensitive = false;
  bool _natural = false;
  bool _padNumbers = true;

  TextTransformResult? _result;
  String? _error;

  @override
  void initState() {
    super.initState();
    for (final controller in [
      _textController,
      _separatorController,
      _maxLengthController,
      _numberStartController,
      _numberSeparatorController,
    ]) {
      controller.addListener(_recompute);
    }
  }

  @override
  void dispose() {
    _textController.dispose();
    _separatorController.dispose();
    _maxLengthController.dispose();
    _numberStartController.dispose();
    _numberSeparatorController.dispose();
    super.dispose();
  }

  void _setOption(VoidCallback update) {
    setState(update);
    _recompute();
  }

  void _recompute() {
    final text = _textController.text;
    if (text.isEmpty) {
      setState(() {
        _result = null;
        _error = null;
      });
      return;
    }
    try {
      final result = switch (_category) {
        _Category.caseConversion => _transformer.convertCase(text, _targetCase),
        _Category.slugify => _transformer.slugify(
            text,
            separator: _separatorController.text,
            lowercase: _slugLowercase,
            maxLength: _parsePositiveInt(_maxLengthController.text),
          ),
        _Category.lines => _transformer.runLineOperation(
            LineOperationInput(
              text: text,
              operation: _lineOperation,
              descending: _sortDescending,
              caseInsensitive: _caseInsensitive,
              natural: _natural,
              startNumber: int.tryParse(_numberStartController.text.trim()) ?? 1,
              numberSeparator: _numberSeparatorController.text,
              padNumbers: _padNumbers,
            ),
          ),
      };
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

  int? _parsePositiveInt(String text) {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return null;
    final value = int.tryParse(trimmed);
    if (value == null || value < 1) return null;
    return value;
  }

  String _describeError(Object e) {
    if (e is FormatException) return e.message;
    if (e is ArgumentError) return e.message?.toString() ?? e.toString();
    return e.toString();
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'Text Case / Slug / Line Tools',
      copyText: _result?.output.isNotEmpty == true ? _result!.output : null,
      inputPanel: _buildInputPanel(context),
      outputPanel: _buildOutputPanel(context),
    );
  }

  Widget _buildInputPanel(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Source text', style: textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _textController,
          maxLines: 10,
          minLines: 6,
          style: AppTheme.monospace,
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Type or paste text here'),
        ),
        const SizedBox(height: 20),
        Text('Operation', style: textTheme.titleMedium),
        const SizedBox(height: 8),
        SegmentedButton<_Category>(
          segments: const [
            ButtonSegment(value: _Category.caseConversion, label: Text('Case')),
            ButtonSegment(value: _Category.slugify, label: Text('Slugify')),
            ButtonSegment(value: _Category.lines, label: Text('Lines')),
          ],
          selected: {_category},
          onSelectionChanged: (selection) => _setOption(() => _category = selection.first),
        ),
        const SizedBox(height: 16),
        switch (_category) {
          _Category.caseConversion => _buildCaseOptions(context),
          _Category.slugify => _buildSlugifyOptions(context),
          _Category.lines => _buildLineOptions(context),
        },
      ],
    );
  }

  Widget _buildCaseOptions(BuildContext context) {
    return DropdownButtonFormField<TextCase>(
      initialValue: _targetCase,
      isExpanded: true,
      decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'Target case'),
      items: [
        for (final target in TextCase.values)
          DropdownMenuItem(value: target, child: Text('${target.label}  ·  ${target.example}')),
      ],
      onChanged: (value) {
        if (value != null) _setOption(() => _targetCase = value);
      },
    );
  }

  Widget _buildSlugifyOptions(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _separatorController,
                decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'Separator'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: _maxLengthController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  labelText: 'Max length (optional)',
                ),
              ),
            ),
          ],
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Lowercase'),
          value: _slugLowercase,
          onChanged: (value) => _setOption(() => _slugLowercase = value),
        ),
        Text(
          'Accented letters are folded to ASCII (é → e) before slugifying.',
          style: textTheme.bodySmall,
        ),
      ],
    );
  }

  Widget _buildLineOptions(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DropdownButtonFormField<LineOperation>(
          initialValue: _lineOperation,
          isExpanded: true,
          decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'Line operation'),
          items: [
            for (final op in LineOperation.values) DropdownMenuItem(value: op, child: Text(op.label)),
          ],
          onChanged: (value) {
            if (value != null) _setOption(() => _lineOperation = value);
          },
        ),
        const SizedBox(height: 8),
        if (_lineOperation == LineOperation.sort) ...[
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Descending'),
            value: _sortDescending,
            onChanged: (value) => _setOption(() => _sortDescending = value),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Case-insensitive'),
            value: _caseInsensitive,
            onChanged: (value) => _setOption(() => _caseInsensitive = value),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Natural order (item2 before item10)'),
            value: _natural,
            onChanged: (value) => _setOption(() => _natural = value),
          ),
        ],
        if (_lineOperation == LineOperation.deduplicate)
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Case-insensitive'),
            value: _caseInsensitive,
            onChanged: (value) => _setOption(() => _caseInsensitive = value),
          ),
        if (_lineOperation == LineOperation.number) ...[
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _numberStartController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'Start at'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _numberSeparatorController,
                  decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'Separator'),
                ),
              ),
            ],
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Pad numbers (right-align)'),
            value: _padNumbers,
            onChanged: (value) => _setOption(() => _padNumbers = value),
          ),
        ],
      ],
    );
  }

  Widget _buildOutputPanel(BuildContext context) {
    if (_error != null) return _errorBanner(context, _error!);

    final result = _result;
    if (result == null) {
      return const Text('Type some text on the left to see the transformed output here.');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('${result.lineCount} line${result.lineCount == 1 ? '' : 's'}', style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 8),
        Container(
          width: double.infinity,
          constraints: const BoxConstraints(maxHeight: 320),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            border: Border.all(color: Theme.of(context).dividerColor),
            borderRadius: BorderRadius.circular(8),
          ),
          child: SingleChildScrollView(
            child: SelectableText(result.output.isEmpty ? '(no output)' : result.output, style: AppTheme.monospace),
          ),
        ),
      ],
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
}
