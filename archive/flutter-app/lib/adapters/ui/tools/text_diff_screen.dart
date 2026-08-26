import 'package:flutter/material.dart';

import '../../../core/utility/text_diff.dart';
import '../shell/app_theme.dart';
import '../shell/tool_detail_scaffold.dart';

/// "Text Diff" screen: two text areas (left/original, right/modified) plus
/// mode and comparison options on the left; the rendered unified-style diff
/// with a summary on the right.
///
/// Backed entirely by [TextDiff], whose LCS-based algorithm means an
/// inserted/removed line never cascades into "changed" lines below it —
/// see the core's doc comment. Recomputes on every keystroke or option
/// change; JSON-mode parse errors are surfaced inline, never thrown.
class TextDiffScreen extends StatefulWidget {
  const TextDiffScreen({super.key});

  @override
  State<TextDiffScreen> createState() => _TextDiffScreenState();
}

class _TextDiffScreenState extends State<TextDiffScreen> {
  static const _differ = TextDiff();

  final _leftController = TextEditingController();
  final _rightController = TextEditingController();

  DiffMode _mode = DiffMode.text;
  bool _ignoreWhitespace = false;
  bool _ignoreCase = false;

  TextDiffResult _result = const TextDiffResult(isValid: true);

  @override
  void initState() {
    super.initState();
    _leftController.addListener(_recompute);
    _rightController.addListener(_recompute);
    _recompute();
  }

  @override
  void dispose() {
    _leftController.dispose();
    _rightController.dispose();
    super.dispose();
  }

  void _recompute() {
    try {
      final result = _differ.execute(
        TextDiffInput(
          left: _leftController.text,
          right: _rightController.text,
          mode: _mode,
          ignoreWhitespace: _ignoreWhitespace,
          ignoreCase: _ignoreCase,
        ),
      );
      setState(() => _result = result);
    } catch (e) {
      setState(() => _result = TextDiffResult(isValid: false, errorMessage: 'Unexpected error: $e'));
    }
  }

  String get _copyText {
    if (!_result.isValid) return '';
    return _result.lines.map((l) => '${l.marker} ${l.text}').join('\n');
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'Text Diff',
      copyText: _copyText.isEmpty ? null : _copyText,
      inputPanel: _buildInputPanel(context),
      outputPanel: _buildOutputPanel(context),
    );
  }

  // ---------------------------------------------------------------------
  // Input panel
  // ---------------------------------------------------------------------

  Widget _buildInputPanel(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Mode', style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        SegmentedButton<DiffMode>(
          segments: const [
            ButtonSegment(value: DiffMode.text, label: Text('Text')),
            ButtonSegment(value: DiffMode.json, label: Text('JSON')),
          ],
          selected: {_mode},
          onSelectionChanged: (selection) {
            setState(() => _mode = selection.first);
            _recompute();
          },
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 4,
          children: [
            _optionChip('Ignore whitespace', _ignoreWhitespace, (v) => setState(() => _ignoreWhitespace = v)),
            _optionChip('Ignore case', _ignoreCase, (v) => setState(() => _ignoreCase = v)),
          ],
        ),
        const SizedBox(height: 16),
        Text('Left (original)', style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _leftController,
          maxLines: 10,
          minLines: 6,
          style: AppTheme.monospace,
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Paste the original text'),
        ),
        const SizedBox(height: 16),
        Text('Right (modified)', style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _rightController,
          maxLines: 10,
          minLines: 6,
          style: AppTheme.monospace,
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Paste the modified text'),
        ),
      ],
    );
  }

  Widget _optionChip(String label, bool value, ValueChanged<bool> onChanged) {
    return FilterChip(
      label: Text(label),
      selected: value,
      onSelected: (selected) {
        onChanged(selected);
        _recompute();
      },
    );
  }

  // ---------------------------------------------------------------------
  // Output panel
  // ---------------------------------------------------------------------

  Widget _buildOutputPanel(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    if (!_result.isValid) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.error, color: scheme.error),
              const SizedBox(width: 8),
              Text('Cannot compute diff', style: theme.textTheme.titleMedium),
            ],
          ),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: scheme.errorContainer, borderRadius: BorderRadius.circular(8)),
            child: Text(
              _result.errorMessage ?? 'Enter text on both sides to compare.',
              style: TextStyle(color: scheme.onErrorContainer),
            ),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _summaryRow(context),
        if (_result.warnings.isNotEmpty) ...[
          const SizedBox(height: 8),
          ..._result.warnings.map(
            (w) => Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: scheme.tertiaryContainer, borderRadius: BorderRadius.circular(8)),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.warning_amber, size: 18, color: scheme.onTertiaryContainer),
                    const SizedBox(width: 8),
                    Expanded(child: Text(w, style: TextStyle(color: scheme.onTertiaryContainer))),
                  ],
                ),
              ),
            ),
          ),
        ],
        const SizedBox(height: 16),
        if (_result.isIdentical)
          Text('No differences.', style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant))
        else
          Container(
            width: double.infinity,
            decoration: BoxDecoration(
              border: Border.all(color: theme.dividerColor),
              borderRadius: BorderRadius.circular(8),
            ),
            clipBehavior: Clip.antiAlias,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [for (final line in _result.lines) _diffLineRow(context, line)],
            ),
          ),
      ],
    );
  }

  Widget _summaryRow(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final summary = _result.summary;
    return Row(
      children: [
        Icon(
          _result.isIdentical ? Icons.check_circle : Icons.difference,
          color: _result.isIdentical ? Colors.green : scheme.primary,
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Wrap(
            spacing: 12,
            children: [
              Text(
                _result.isIdentical ? 'Identical' : 'Differences found',
                style: theme.textTheme.titleMedium,
              ),
              Text('+${summary.added}', style: TextStyle(color: scheme.primary, fontWeight: FontWeight.w600)),
              Text('-${summary.removed}', style: TextStyle(color: scheme.error, fontWeight: FontWeight.w600)),
              Text('~${summary.changed} changed', style: theme.textTheme.bodyMedium),
              Text('${summary.unchanged} unchanged', style: theme.textTheme.bodyMedium),
            ],
          ),
        ),
      ],
    );
  }

  Widget _diffLineRow(BuildContext context, DiffLine line) {
    final scheme = Theme.of(context).colorScheme;
    final (background, foreground) = switch (line.kind) {
      DiffLineKind.added => (scheme.primaryContainer, scheme.onPrimaryContainer),
      DiffLineKind.removed => (scheme.errorContainer, scheme.onErrorContainer),
      DiffLineKind.unchanged => (Colors.transparent, scheme.onSurface),
    };

    final leftNum = line.leftLineNumber?.toString() ?? '';
    final rightNum = line.rightLineNumber?.toString() ?? '';

    return Container(
      width: double.infinity,
      color: background,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 32,
            child: Text(leftNum, style: AppTheme.monospace.copyWith(fontSize: 11, color: scheme.onSurfaceVariant)),
          ),
          SizedBox(
            width: 32,
            child: Text(rightNum, style: AppTheme.monospace.copyWith(fontSize: 11, color: scheme.onSurfaceVariant)),
          ),
          SizedBox(
            width: 16,
            child: Text(line.marker, style: AppTheme.monospace.copyWith(color: foreground, fontWeight: FontWeight.bold)),
          ),
          Expanded(
            child: Text(
              line.text.isEmpty ? ' ' : line.text,
              style: AppTheme.monospace.copyWith(color: foreground),
              softWrap: true,
            ),
          ),
        ],
      ),
    );
  }
}
