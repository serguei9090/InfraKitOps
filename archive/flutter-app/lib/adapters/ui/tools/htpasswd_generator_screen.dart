import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/utility/htpasswd_generator.dart';
import '../shell/app_theme.dart';
import '../shell/file_drop_field.dart';
import '../shell/tool_detail_scaffold.dart';

/// htpasswd / HTTP Basic auth generator: pick an algorithm, add one or more
/// user/password pairs, and get back both a ready-to-install `.htpasswd`
/// file and the `Authorization: Basic …` header for each credential — the
/// two halves of debugging a Basic-auth-protected endpoint.
class HtpasswdGeneratorScreen extends StatefulWidget {
  const HtpasswdGeneratorScreen({super.key});

  @override
  State<HtpasswdGeneratorScreen> createState() => _HtpasswdGeneratorScreenState();
}

class _CredentialRow {
  _CredentialRow({required this.id, String username = '', String password = ''})
    : usernameController = TextEditingController(text: username),
      passwordController = TextEditingController(text: password);

  final int id;
  final TextEditingController usernameController;
  final TextEditingController passwordController;
  bool obscure = true;

  void dispose() {
    usernameController.dispose();
    passwordController.dispose();
  }
}

class _HtpasswdGeneratorScreenState extends State<HtpasswdGeneratorScreen> {
  static const _generator = HtpasswdGenerator();
  static const _headerBuilder = BasicAuthHeaderBuilder();

  HtpasswdAlgorithm _algorithm = HtpasswdAlgorithm.bcrypt;
  int _bcryptCost = kHtpasswdDefaultBcryptCost;
  bool _includeHeaderComment = false;

  int _nextId = 0;
  final List<_CredentialRow> _rows = [];

  String? _saveStatus;
  bool _saveWasError = false;

  @override
  void initState() {
    super.initState();
    _addRow();
  }

  @override
  void dispose() {
    for (final row in _rows) {
      row.dispose();
    }
    super.dispose();
  }

  void _addRow() {
    setState(() => _rows.add(_CredentialRow(id: _nextId++)));
  }

  void _removeRow(int id) {
    setState(() {
      final row = _rows.firstWhere((r) => r.id == id);
      row.dispose();
      _rows.removeWhere((r) => r.id == id);
    });
  }

  /// Builds the [HtpasswdGeneratorResult], or captures whatever went wrong
  /// (an empty list, an invalid username, a bcrypt cost the package itself
  /// rejects) as plain text — nothing here should ever throw past this
  /// method into the widget tree.
  ({HtpasswdGeneratorResult? result, String? error}) _generate() {
    try {
      final entries = [
        for (final row in _rows)
          HtpasswdEntry(username: row.usernameController.text, password: row.passwordController.text),
      ];
      final result = _generator.execute(
        HtpasswdGeneratorInput(
          entries: entries,
          algorithm: _algorithm,
          bcryptCost: _bcryptCost,
          includeHeaderComment: _includeHeaderComment,
        ),
      );
      return (result: result, error: null);
    } catch (e) {
      final message = e is ArgumentError ? (e.message?.toString() ?? e.toString()) : e.toString();
      return (result: null, error: message);
    }
  }

  /// The `Authorization: Basic …` line for one row, or null if the current
  /// username/password can't build one yet (e.g. a username with a colon,
  /// while the field is still being edited).
  String? _headerLineFor(_CredentialRow row) {
    try {
      return _headerBuilder
          .execute(BasicAuthHeaderInput(username: row.usernameController.text, password: row.passwordController.text))
          .headerLine;
    } catch (_) {
      return null;
    }
  }

  Future<void> _copy(String text) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Copied to clipboard'), duration: Duration(seconds: 1)),
      );
    }
  }

  Future<void> _save(HtpasswdGeneratorResult result) async {
    setState(() => _saveStatus = null);
    try {
      final savedTo = await saveBytesWithDialog(
        bytes: utf8.encode(result.fileContent),
        suggestedName: result.suggestedFileName,
        mimeType: 'text/plain',
      );
      if (!mounted) return;
      setState(() {
        _saveWasError = false;
        _saveStatus = savedTo == null ? 'Save cancelled.' : 'Saved to $savedTo';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saveWasError = true;
        _saveStatus = 'Could not save: $e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final generated = _generate();

    return ToolDetailScaffold(
      title: 'htpasswd / Basic Auth Generator',
      copyText: generated.result?.fileContent,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Algorithm', style: textTheme.titleMedium),
          const SizedBox(height: 8),
          DropdownButtonFormField<HtpasswdAlgorithm>(
            initialValue: _algorithm,
            isExpanded: true,
            decoration: const InputDecoration(isDense: true),
            items: [
              for (final algorithm in HtpasswdAlgorithm.values)
                DropdownMenuItem(value: algorithm, child: Text(algorithm.label)),
            ],
            onChanged: (v) => setState(() => _algorithm = v ?? _algorithm),
          ),
          const SizedBox(height: 6),
          Text(_algorithm.description, style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
          if (_algorithm.isLegacy) ...[
            const SizedBox(height: 8),
            _inlineNotice(context, 'Legacy format — do not choose this for a new deployment.', critical: false),
          ],

          if (_algorithm.hasCostFactor) ...[
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(child: Text('bcrypt cost', style: textTheme.titleMedium)),
                Text('$_bcryptCost', style: textTheme.titleMedium?.copyWith(color: scheme.primary)),
              ],
            ),
            Slider(
              value: _bcryptCost.toDouble(),
              min: kHtpasswdMinBcryptCost.toDouble(),
              max: kHtpasswdMaxBcryptCost.toDouble(),
              divisions: kHtpasswdMaxBcryptCost - kHtpasswdMinBcryptCost,
              label: '$_bcryptCost',
              onChanged: (v) => setState(() => _bcryptCost = v.round()),
            ),
            if (_bcryptCost < kHtpasswdWeakBcryptCost)
              Text(
                'Cost $_bcryptCost is low — $kHtpasswdWeakBcryptCost is the minimum worth deploying.',
                style: textTheme.bodySmall?.copyWith(color: scheme.error),
              ),
          ],

          const SizedBox(height: 8),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            dense: true,
            title: const Text('Include a "# generated by" header comment'),
            value: _includeHeaderComment,
            onChanged: (v) => setState(() => _includeHeaderComment = v),
          ),

          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(child: Text('Users', style: textTheme.titleMedium)),
              TextButton.icon(
                onPressed: _addRow,
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Add user'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          for (final row in _rows) _buildCredentialRow(context, row),
        ],
      ),
      outputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text('Generated .htpasswd file', style: textTheme.titleMedium)),
              OutlinedButton.icon(
                onPressed: generated.result == null ? null : () => _save(generated.result!),
                icon: const Icon(Icons.download, size: 16),
                label: const Text('Save as file'),
              ),
            ],
          ),
          if (_saveStatus != null) ...[
            const SizedBox(height: 8),
            Text(_saveStatus!, style: textTheme.bodySmall?.copyWith(color: _saveWasError ? scheme.error : scheme.primary)),
          ],
          const SizedBox(height: 12),
          if (generated.error != null) _inlineNotice(context, generated.error!, critical: true),
          if (generated.result != null && generated.result!.warnings.isNotEmpty) ...[
            _buildWarnings(context, generated.result!.warnings),
            const SizedBox(height: 8),
          ],
          if (generated.result != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: scheme.surface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: scheme.outlineVariant),
              ),
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: SelectableText(generated.result!.fileContent, style: AppTheme.monospace),
              ),
            ),

          const SizedBox(height: 20),
          Text('Basic auth header', style: textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            'Authorization header for each user above — paste straight into a request.',
            style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 8),
          for (final row in _rows) _buildHeaderRow(context, row),
        ],
      ),
    );
  }

  Widget _buildCredentialRow(BuildContext context, _CredentialRow row) {
    final scheme = Theme.of(context).colorScheme;
    final usernameError = row.usernameController.text.isEmpty ? null : validateHtpasswdUsername(row.usernameController.text);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: TextField(
              controller: row.usernameController,
              decoration: InputDecoration(labelText: 'Username', isDense: true, errorText: usernameError),
              onChanged: (_) => setState(() {}),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: TextField(
              controller: row.passwordController,
              obscureText: row.obscure,
              decoration: InputDecoration(
                labelText: 'Password',
                isDense: true,
                suffixIcon: IconButton(
                  iconSize: 18,
                  icon: Icon(row.obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                  onPressed: () => setState(() => row.obscure = !row.obscure),
                ),
              ),
              onChanged: (_) => setState(() {}),
            ),
          ),
          IconButton(
            tooltip: 'Remove user',
            icon: const Icon(Icons.delete_outline),
            onPressed: () => _removeRow(row.id),
          ),
        ],
      ),
    );
  }

  Widget _buildHeaderRow(BuildContext context, _CredentialRow row) {
    final scheme = Theme.of(context).colorScheme;
    final username = row.usernameController.text;
    final header = _headerLineFor(row);

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: scheme.surface,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: scheme.outlineVariant),
              ),
              child: SelectableText(
                header ?? (username.isEmpty ? 'Add a username to generate this header.' : 'Cannot build a header for this username.'),
                style: header != null ? AppTheme.monospace.copyWith(fontSize: 12) : Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            tooltip: 'Copy header',
            icon: const Icon(Icons.copy, size: 18),
            onPressed: header == null ? null : () => _copy(header),
          ),
        ],
      ),
    );
  }

  Widget _buildWarnings(BuildContext context, List<String> warnings) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.tertiaryContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.info_outline, color: scheme.onTertiaryContainer, size: 20),
              const SizedBox(width: 8),
              Text(
                'Advisories',
                style: TextStyle(color: scheme.onTertiaryContainer, fontWeight: FontWeight.w800, letterSpacing: 0.3),
              ),
            ],
          ),
          const SizedBox(height: 8),
          for (final warning in warnings)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(warning, style: TextStyle(color: scheme.onTertiaryContainer)),
            ),
        ],
      ),
    );
  }

  Widget _inlineNotice(BuildContext context, String message, {required bool critical}) {
    final scheme = Theme.of(context).colorScheme;
    final bg = critical ? scheme.errorContainer : scheme.surfaceContainerHighest;
    final fg = critical ? scheme.onErrorContainer : scheme.onSurfaceVariant;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(critical ? Icons.error_outline : Icons.info_outline, color: fg, size: 18),
          const SizedBox(width: 8),
          Expanded(child: Text(message, style: TextStyle(color: fg, fontWeight: critical ? FontWeight.w600 : FontWeight.normal))),
        ],
      ),
    );
  }
}
