import 'package:flutter/material.dart';

import '../../../core/utility/regex_tester.dart';
import '../shell/app_theme.dart';
import '../shell/tool_detail_scaffold.dart';

/// "Regex Tester" screen: a pattern + flags + subject on the left, and on the
/// right the match list (offsets, numbered/named capture groups), the
/// subject with matches highlighted inline, and a plain-English breakdown of
/// the pattern from [RegexTester.explain].
///
/// Recomputes on every keystroke via [RegexTester.execute]; every failure
/// mode the core reports (`isValid: false`, or an unexpected exception) is
/// caught and rendered inline — nothing here ever lets an exception reach
/// the widget tree.
class RegexTesterScreen extends StatefulWidget {
  const RegexTesterScreen({super.key});

  @override
  State<RegexTesterScreen> createState() => _RegexTesterScreenState();
}

class _RegexTesterScreenState extends State<RegexTesterScreen> {
  static const _tester = RegexTester();

  final _patternController = TextEditingController();
  final _subjectController = TextEditingController();

  bool _caseInsensitive = false;
  bool _multiLine = false;
  bool _dotAll = false;
  bool _unicode = false;

  RegexTesterResult _result = const RegexTesterResult(isValid: false);

  @override
  void initState() {
    super.initState();
    _patternController.addListener(_recompute);
    _subjectController.addListener(_recompute);
    _recompute();
  }

  @override
  void dispose() {
    _patternController.dispose();
    _subjectController.dispose();
    super.dispose();
  }

  void _recompute() {
    try {
      final result = _tester.execute(
        RegexTesterInput(
          pattern: _patternController.text,
          subject: _subjectController.text,
          caseInsensitive: _caseInsensitive,
          multiLine: _multiLine,
          dotAll: _dotAll,
          unicode: _unicode,
        ),
      );
      setState(() => _result = result);
    } catch (e) {
      // Defensive: the core already catches every regex-engine failure, but
      // nothing here should ever let an exception reach the UI.
      setState(() => _result = RegexTesterResult(isValid: false, errorMessage: 'Unexpected error: $e'));
    }
  }

  String get _copyText {
    if (!_result.isValid) return '';
    final buffer = StringBuffer();
    for (final match in _result.matches) {
      buffer.writeln('[${match.index}] ${match.start}-${match.end}: ${match.text}');
      for (final group in match.groups) {
        buffer.writeln('    group ${group.label}: ${group.value ?? '(did not participate)'}');
      }
    }
    return buffer.toString().trimRight();
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'Regex Tester',
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
        Text('Pattern', style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _patternController,
          style: AppTheme.monospace,
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: r'e.g. (?<year>\d{4})-\d{2}-\d{2}'),
        ),
        const SizedBox(height: 16),
        Text('Flags', style: theme.textTheme.titleMedium),
        const SizedBox(height: 4),
        Wrap(
          spacing: 4,
          children: [
            _flagSwitch('i — case-insensitive', _caseInsensitive, (v) => setState(() => _caseInsensitive = v)),
            _flagSwitch('m — multiline', _multiLine, (v) => setState(() => _multiLine = v)),
            _flagSwitch('s — dot all', _dotAll, (v) => setState(() => _dotAll = v)),
            _flagSwitch('u — unicode', _unicode, (v) => setState(() => _unicode = v)),
          ],
        ),
        const SizedBox(height: 16),
        Text('Subject', style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _subjectController,
          maxLines: 14,
          minLines: 8,
          style: AppTheme.monospace,
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Paste text to match against'),
        ),
      ],
    );
  }

  Widget _flagSwitch(String label, bool value, ValueChanged<bool> onChanged) {
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
              Text('Invalid pattern', style: theme.textTheme.titleMedium),
            ],
          ),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: scheme.errorContainer, borderRadius: BorderRadius.circular(8)),
            child: Text(
              _result.errorMessage ?? 'Enter a pattern to see matches.',
              style: TextStyle(color: scheme.onErrorContainer),
            ),
          ),
          if (_result.explanation.isNotEmpty) ...[
            const SizedBox(height: 20),
            _explanationSection(context),
          ],
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
            Text('${_result.matchCount} match${_result.matchCount == 1 ? '' : 'es'}', style: theme.textTheme.titleMedium),
          ],
        ),
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
        if (_subjectController.text.isNotEmpty) ...[
          Text('Subject (matches highlighted)', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              border: Border.all(color: theme.dividerColor),
              borderRadius: BorderRadius.circular(8),
            ),
            child: SelectableText.rich(_highlightedSubject(context)),
          ),
          const SizedBox(height: 20),
        ],
        Text('Matches', style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        if (_result.matches.isEmpty)
          Text('No matches.', style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant))
        else
          ..._result.matches.map((m) => _matchCard(context, m)),
        const SizedBox(height: 20),
        _explanationSection(context),
      ],
    );
  }

  TextSpan _highlightedSubject(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final subject = _subjectController.text;
    final spans = <TextSpan>[];
    var cursor = 0;

    for (final match in _result.matches) {
      if (match.start > subject.length || match.end > subject.length) continue;
      if (match.start < cursor) continue;
      if (match.start > cursor) {
        spans.add(TextSpan(text: subject.substring(cursor, match.start)));
      }
      spans.add(
        TextSpan(
          text: subject.substring(match.start, match.end),
          style: TextStyle(
            backgroundColor: scheme.primaryContainer,
            color: scheme.onPrimaryContainer,
            fontWeight: FontWeight.w600,
          ),
        ),
      );
      cursor = match.end;
    }
    if (cursor < subject.length) {
      spans.add(TextSpan(text: subject.substring(cursor)));
    }

    return TextSpan(style: AppTheme.monospace.copyWith(color: scheme.onSurface), children: spans);
  }

  Widget _matchCard(BuildContext context, RegexMatchResult match) {
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
              'Match ${match.index} — offsets ${match.start}-${match.end}',
              style: theme.textTheme.labelLarge?.copyWith(color: scheme.primary),
            ),
            const SizedBox(height: 4),
            SelectableText(match.text.isEmpty ? '(empty match)' : match.text, style: AppTheme.monospace),
            if (match.groups.isNotEmpty) ...[
              const SizedBox(height: 8),
              Divider(height: 1, color: scheme.outlineVariant),
              const SizedBox(height: 8),
              ...match.groups.map(
                (g) => Padding(
                  padding: const EdgeInsets.only(bottom: 2),
                  child: Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(text: 'group ${g.label}: ', style: theme.textTheme.bodySmall),
                        TextSpan(
                          text: g.didParticipate ? g.value! : '(did not participate)',
                          style: AppTheme.monospace.copyWith(
                            fontSize: 12,
                            color: g.didParticipate ? scheme.onSurface : scheme.onSurfaceVariant,
                            fontStyle: g.didParticipate ? FontStyle.normal : FontStyle.italic,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _explanationSection(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    if (_result.explanation.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Pattern breakdown', style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            border: Border.all(color: theme.dividerColor),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final token in _result.explanation)
                Padding(
                  padding: EdgeInsets.only(left: token.depth * 16.0, bottom: 6),
                  child: Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text: token.token,
                          style: AppTheme.monospace.copyWith(color: scheme.primary, fontWeight: FontWeight.w600),
                        ),
                        TextSpan(text: '  ${token.description}', style: theme.textTheme.bodySmall),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
