import 'package:flutter/material.dart';

import '../../../core/config/docker_run_converter.dart';
import '../shell/app_theme.dart';
import '../shell/tool_detail_scaffold.dart';

const _examplePlaceholder = 'docker run -d --name web -p 8080:80 \\\n'
    '  -e "APP_ENV=production" \\\n'
    '  -v webdata:/var/lib/data \\\n'
    '  --restart unless-stopped \\\n'
    '  nginx:1.25';

/// "Docker Run -> Compose" converter screen: pastes a `docker run ...`
/// command line and generates the equivalent `docker-compose.yml` service
/// definition via [DockerRunConverter]. Built on the shared
/// [ToolDetailScaffold] split layout.
///
/// The conversion is pure and synchronous, so it re-runs on every keystroke.
/// [DockerRunConverter.execute] never throws — a malformed command comes
/// back as `isValid: false` with an [DockerRunResult.errorMessage] — but the
/// call is still wrapped defensively so no unexpected exception from the
/// core can ever reach this widget tree.
class DockerRunConverterScreen extends StatefulWidget {
  const DockerRunConverterScreen({super.key});

  @override
  State<DockerRunConverterScreen> createState() => _DockerRunConverterScreenState();
}

class _DockerRunConverterScreenState extends State<DockerRunConverterScreen> {
  static const _useCase = DockerRunConverter();

  final _commandController = TextEditingController();

  DockerRunResult? _result;
  String? _crashMessage;

  @override
  void initState() {
    super.initState();
    _commandController.addListener(_recompute);
  }

  @override
  void dispose() {
    _commandController.dispose();
    super.dispose();
  }

  void _recompute() {
    try {
      final result = _useCase.execute(DockerRunInput(command: _commandController.text));
      setState(() {
        _result = result;
        _crashMessage = null;
      });
    } catch (e) {
      // Defensive net: DockerRunConverter.execute is documented not to
      // throw, but a UI screen must never let ANY exception from the core
      // escape into the widget tree.
      setState(() {
        _result = null;
        _crashMessage = 'Could not convert this command: $e';
      });
    }
  }

  void _loadExample() {
    _commandController.text = _examplePlaceholder;
    _recompute();
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    final yaml = result != null && result.isValid ? result.yaml : null;

    return ToolDetailScaffold(
      title: 'Docker Run → Compose Converter',
      copyText: yaml,
      inputPanel: _buildInputPanel(context),
      outputPanel: _buildOutputPanel(context, result),
    );
  }

  Widget _buildInputPanel(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text('docker run command', style: theme.textTheme.titleMedium),
            ),
            OutlinedButton.icon(
              onPressed: _loadExample,
              icon: const Icon(Icons.auto_fix_high, size: 16),
              label: const Text('Load example'),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          'Paste a docker run command exactly as written, multi-line with '
          'trailing backslashes is fine. Quoting is honoured, so '
          '-e "FOO=bar baz" survives as one value.',
          style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _commandController,
          minLines: 10,
          maxLines: 24,
          style: AppTheme.monospace,
          decoration: InputDecoration(
            hintText: _examplePlaceholder,
            hintStyle: AppTheme.monospace.copyWith(color: scheme.onSurfaceVariant.withValues(alpha: 0.6)),
            alignLabelWithHint: true,
          ),
        ),
        if (_crashMessage != null) ...[
          const SizedBox(height: 16),
          _noticeCard(
            context,
            icon: Icons.error_outline,
            background: scheme.errorContainer,
            foreground: scheme.onErrorContainer,
            text: _crashMessage!,
          ),
        ],
      ],
    );
  }

  Widget _buildOutputPanel(BuildContext context, DockerRunResult? result) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    if (_commandController.text.trim().isEmpty && result == null) {
      return Text(
        'Paste a docker run command on the left to generate docker-compose.yml.',
        style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
      );
    }

    if (result == null || !result.isValid) {
      final message = result?.errorMessage ?? 'Paste a docker run command to convert.';
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _noticeCard(
            context,
            icon: Icons.error_outline,
            background: scheme.errorContainer,
            foreground: scheme.onErrorContainer,
            text: message,
          ),
          if (result != null && result.warnings.isNotEmpty) ...[
            const SizedBox(height: 14),
            ..._warningsSection(context, result.warnings),
          ],
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('docker-compose.yml', style: theme.textTheme.titleMedium),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: SizedBox(
              width: double.infinity,
              child: SelectableText(result.yaml ?? '', style: AppTheme.monospace),
            ),
          ),
        ),
        if (result.warnings.isNotEmpty) ...[
          const SizedBox(height: 16),
          ..._warningsSection(context, result.warnings),
        ],
        if (result.notes.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('Notes', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          for (final note in result.notes) ...[
            _noticeCard(
              context,
              icon: Icons.info_outline,
              background: scheme.secondaryContainer.withValues(alpha: 0.5),
              foreground: scheme.onSecondaryContainer,
              text: note,
            ),
            const SizedBox(height: 8),
          ],
        ],
      ],
    );
  }

  List<Widget> _warningsSection(BuildContext context, List<String> warnings) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return [
      Row(
        children: [
          Icon(Icons.warning_amber_outlined, size: 18, color: scheme.error),
          const SizedBox(width: 6),
          Text(
            'Unsupported / ignored flags (${warnings.length})',
            style: theme.textTheme.titleSmall?.copyWith(color: scheme.error),
          ),
        ],
      ),
      const SizedBox(height: 4),
      Text(
        'These flags were recognised but not translated. Review them before '
        'relying on the generated file.',
        style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
      ),
      const SizedBox(height: 8),
      for (final warning in warnings) ...[
        _noticeCard(
          context,
          icon: Icons.warning_amber_outlined,
          background: scheme.tertiaryContainer,
          foreground: scheme.onTertiaryContainer,
          text: warning,
        ),
        const SizedBox(height: 8),
      ],
    ];
  }

  Widget _noticeCard(
    BuildContext context, {
    required IconData icon,
    required Color background,
    required Color foreground,
    required String text,
  }) {
    return Card(
      color: background,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 18, color: foreground),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                text,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: foreground),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
