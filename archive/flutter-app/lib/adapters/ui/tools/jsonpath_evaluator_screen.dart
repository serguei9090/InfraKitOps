import 'package:flutter/material.dart';

import '../../../core/utility/jsonpath_evaluator.dart';
import '../shell/app_theme.dart';
import '../shell/tool_detail_scaffold.dart';

/// "JSONPath Evaluator" screen: a JSON document and a JSONPath expression on
/// the left, and on the right the matched values (as pretty JSON, with their
/// resolved paths) plus a match count.
///
/// Backed by [JsonPathEvaluator], which parses the document once and reports
/// malformed JSON or an unsupported/invalid expression as a clean
/// [JsonPathResult.errorMessage] rather than throwing — this screen mirrors
/// that by recomputing on every keystroke and never letting an exception
/// reach the widget tree.
class JsonPathEvaluatorScreen extends StatefulWidget {
  const JsonPathEvaluatorScreen({super.key});

  @override
  State<JsonPathEvaluatorScreen> createState() => _JsonPathEvaluatorScreenState();
}

class _JsonPathEvaluatorScreenState extends State<JsonPathEvaluatorScreen> {
  static const _evaluator = JsonPathEvaluator();

  final _documentController = TextEditingController();
  final _expressionController = TextEditingController();

  JsonPathResult _result = const JsonPathResult(isValid: false);

  @override
  void initState() {
    super.initState();
    _documentController.addListener(_recompute);
    _expressionController.addListener(_recompute);
    _expressionController.text = r'$';
    _recompute();
  }

  @override
  void dispose() {
    _documentController.dispose();
    _expressionController.dispose();
    super.dispose();
  }

  void _recompute() {
    try {
      final result = _evaluator.execute(
        JsonPathEvaluatorInput(document: _documentController.text, expression: _expressionController.text),
      );
      setState(() => _result = result);
    } catch (e) {
      setState(() => _result = JsonPathResult(isValid: false, errorMessage: 'Unexpected error: $e'));
    }
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'JSONPath Evaluator',
      copyText: _result.isValid ? _result.prettyValues : null,
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
        Text('JSON document', style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _documentController,
          maxLines: 16,
          minLines: 10,
          style: AppTheme.monospace,
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Paste a JSON document here'),
        ),
        const SizedBox(height: 16),
        Text('JSONPath expression', style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _expressionController,
          style: AppTheme.monospace,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: r'e.g. $.store.book[?(@.price < 10)].title',
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Supports \$, .name, [\'name\'], wildcards * and [*], indexes '
          'including negative, slices [start:end:step], recursive descent '
          '.., and simple filters [?(@.x == 1)].',
          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
      ],
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
              Text('Cannot evaluate', style: theme.textTheme.titleMedium),
            ],
          ),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: scheme.errorContainer, borderRadius: BorderRadius.circular(8)),
            child: Text(
              _result.errorMessage ?? 'Enter a document and an expression to see results.',
              style: TextStyle(color: scheme.onErrorContainer),
            ),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.check_circle, color: Colors.green),
            const SizedBox(width: 8),
            Text(
              '${_result.matchCount} match${_result.matchCount == 1 ? '' : 'es'}',
              style: theme.textTheme.titleMedium,
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (_result.matches.isEmpty)
          Text('No matches.', style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant))
        else
          ..._result.matches.asMap().entries.map((entry) => _matchCard(context, entry.key, entry.value)),
      ],
    );
  }

  Widget _matchCard(BuildContext context, int index, JsonPathMatch match) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '[$index] ${match.path}',
              style: AppTheme.monospace.copyWith(color: scheme.primary, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
                borderRadius: BorderRadius.circular(6),
              ),
              child: SelectableText(match.prettyValue, style: AppTheme.monospace),
            ),
          ],
        ),
      ),
    );
  }
}
