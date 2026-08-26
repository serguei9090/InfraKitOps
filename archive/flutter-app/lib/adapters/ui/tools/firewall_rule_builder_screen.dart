import 'dart:convert';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import '../../../core/config/firewall_rule_builder.dart';
import '../shell/app_theme.dart';
import '../shell/file_drop_field.dart';
import '../shell/tool_detail_scaffold.dart';

/// Firewall Rule Builder: assemble a set of allow/deny/reject/rate-limit
/// rules plus a default policy, and render either a `ufw` command script or
/// an `nft` ruleset.
///
/// The one thing this screen must never let happen quietly is a generated
/// script that drops the operator's own SSH session. The core
/// ([FirewallRuleBuilder]) already computes that check
/// ([FirewallWarning.sshLockoutCode]) and returns it as a
/// [FirewallWarningSeverity.critical] warning — this screen's job is to make
/// that warning impossible to miss, so it gets a full-width colored banner
/// rather than being folded into the ordinary output text.
class FirewallRuleBuilderScreen extends StatefulWidget {
  const FirewallRuleBuilderScreen({super.key});

  @override
  State<FirewallRuleBuilderScreen> createState() => _FirewallRuleBuilderScreenState();
}

class _RuleRow {
  _RuleRow({
    required this.id,
    required this.action,
    required this.direction,
    required this.protocol,
    String port = '',
    String source = '',
    String comment = '',
  }) : portController = TextEditingController(text: port),
       sourceController = TextEditingController(text: source),
       commentController = TextEditingController(text: comment);

  final int id;
  FirewallAction action;
  FirewallDirection direction;
  FirewallProtocol protocol;
  final TextEditingController portController;
  final TextEditingController sourceController;
  final TextEditingController commentController;

  void dispose() {
    portController.dispose();
    sourceController.dispose();
    commentController.dispose();
  }
}

class _FirewallRuleBuilderScreenState extends State<FirewallRuleBuilderScreen> {
  static const _builder = FirewallRuleBuilder();

  FirewallDialect _dialect = FirewallDialect.ufw;
  FirewallAction _incoming = FirewallAction.deny;
  FirewallAction _outgoing = FirewallAction.allow;
  FirewallAction _forward = FirewallAction.deny;
  bool _includeHeader = true;
  bool _allowLoopback = true;
  bool _allowEstablished = true;
  bool _allowIcmp = true;

  final _sshPortController = TextEditingController(text: '22');
  int _nextId = 0;
  final List<_RuleRow> _rows = [];

  String? _saveStatus;
  bool _saveWasError = false;

  @override
  void initState() {
    super.initState();
    // Seed with an SSH allow rule so the default state of the screen is
    // already lockout-safe — the critical warning is something a user
    // should have to remove a rule to trigger, not start out with.
    final sshPreset = firewallPresetFor('SSH');
    if (sshPreset != null) {
      _addRow(seed: sshPreset.toRule());
    } else {
      _addRow();
    }
  }

  @override
  void dispose() {
    _sshPortController.dispose();
    for (final row in _rows) {
      row.dispose();
    }
    super.dispose();
  }

  void _addRow({FirewallRule? seed}) {
    setState(() {
      _rows.add(
        _RuleRow(
          id: _nextId++,
          action: seed?.action ?? FirewallAction.allow,
          direction: seed?.direction ?? FirewallDirection.inbound,
          protocol: seed?.protocol ?? FirewallProtocol.tcp,
          port: seed?.ports != null ? '${seed!.ports!.start}${seed.ports!.isSingle ? '' : '-${seed.ports!.end}'}' : '',
          source: seed?.source ?? '',
          comment: seed?.comment ?? '',
        ),
      );
    });
  }

  void _removeRow(int id) {
    setState(() {
      final row = _rows.firstWhere((r) => r.id == id);
      row.dispose();
      _rows.removeWhere((r) => r.id == id);
    });
  }

  /// Builds the [FirewallScriptResult], or captures whatever went wrong as a
  /// plain string — an invalid port/CIDR must produce inline error text, not
  /// an uncaught exception.
  ({FirewallScriptResult? result, String? error}) _generate() {
    try {
      final rules = <FirewallRule>[
        for (final row in _rows)
          FirewallRule(
            action: row.action,
            direction: row.direction,
            protocol: row.protocol,
            ports: row.portController.text.trim().isEmpty ? null : PortRange.parse(row.portController.text.trim()),
            source: row.sourceController.text.trim().isEmpty ? null : row.sourceController.text.trim(),
            comment: row.commentController.text.trim().isEmpty ? null : row.commentController.text.trim(),
          ),
      ];

      final sshPort = int.tryParse(_sshPortController.text.trim()) ?? 22;

      final result = _builder.execute(
        FirewallRuleSetInput(
          dialect: _dialect,
          rules: rules,
          policy: FirewallPolicy(incoming: _incoming, outgoing: _outgoing, forward: _forward),
          sshPort: sshPort,
          includeHeader: _includeHeader,
          allowLoopback: _allowLoopback,
          allowEstablished: _allowEstablished,
          allowIcmp: _allowIcmp,
        ),
      );
      return (result: result, error: null);
    } catch (e) {
      final message = e is ArgumentError ? (e.message?.toString() ?? e.toString()) : e.toString();
      return (result: null, error: message);
    }
  }

  Future<void> _save(FirewallScriptResult result) async {
    setState(() => _saveStatus = null);
    try {
      final savedTo = await saveBytesWithDialog(
        bytes: utf8.encode(result.script),
        suggestedName: result.suggestedFileName,
        mimeType: 'text/plain',
        acceptedTypes: [
          XTypeGroup(label: 'Firewall script', extensions: [_dialect.fileExtension]),
        ],
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
      title: 'Firewall Rule Builder',
      copyText: generated.result?.script,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Dialect', style: textTheme.titleMedium),
          const SizedBox(height: 8),
          SegmentedButton<FirewallDialect>(
            segments: [
              for (final dialect in FirewallDialect.values)
                ButtonSegment(value: dialect, label: Text(dialect.label)),
            ],
            selected: {_dialect},
            onSelectionChanged: (s) => setState(() => _dialect = s.first),
          ),
          const SizedBox(height: 20),

          Text('Default policy', style: textTheme.titleMedium),
          const SizedBox(height: 8),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              _policyDropdown('Incoming', _incoming, (v) => setState(() => _incoming = v)),
              _policyDropdown('Outgoing', _outgoing, (v) => setState(() => _outgoing = v)),
              if (_dialect == FirewallDialect.nftables)
                _policyDropdown('Forward', _forward, (v) => setState(() => _forward = v)),
            ],
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: 140,
            child: TextField(
              controller: _sshPortController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'SSH port', isDense: true),
              onChanged: (_) => setState(() {}),
            ),
          ),
          if (_dialect == FirewallDialect.nftables) ...[
            const SizedBox(height: 12),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: const Text('Accept loopback traffic'),
              value: _allowLoopback,
              onChanged: (v) => setState(() => _allowLoopback = v),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: const Text('Accept established/related connections'),
              value: _allowEstablished,
              onChanged: (v) => setState(() => _allowEstablished = v),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: const Text('Accept ICMP / ICMPv6'),
              value: _allowIcmp,
              onChanged: (v) => setState(() => _allowIcmp = v),
            ),
          ],
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            dense: true,
            title: const Text('Include explanatory header comment'),
            value: _includeHeader,
            onChanged: (v) => setState(() => _includeHeader = v),
          ),
          const SizedBox(height: 20),

          Text('Quick-add a common service', style: textTheme.titleMedium),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final preset in kFirewallServicePresets)
                Tooltip(
                  message: preset.exposureNote != null ? '${preset.description}\n\n⚠ ${preset.exposureNote}' : preset.description,
                  child: OutlinedButton.icon(
                    onPressed: () => _addRow(seed: preset.toRule()),
                    icon: const Icon(Icons.add, size: 16),
                    label: Text(preset.label),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 20),

          Row(
            children: [
              Expanded(child: Text('Rules', style: textTheme.titleMedium)),
              TextButton.icon(
                onPressed: () => _addRow(),
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Add rule'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (_rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text('No rules yet — add one above.', style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
            ),
          for (final row in _rows) _buildRuleRow(context, row),
        ],
      ),
      outputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text('Generated script', style: textTheme.titleMedium)),
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
          if (generated.error != null) _buildErrorBanner(context, generated.error!),
          if (generated.result != null && generated.result!.warnings.isNotEmpty) _buildWarningBanner(context, generated.result!),
          const SizedBox(height: 8),
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
                child: SelectableText(generated.result!.script, style: AppTheme.monospace),
              ),
            ),
        ],
      ),
    );
  }

  Widget _policyDropdown(String label, FirewallAction value, ValueChanged<FirewallAction> onChanged) {
    final choices = FirewallAction.values.where((a) => a.validAsPolicy).toList();
    return SizedBox(
      width: 180,
      child: DropdownButtonFormField<FirewallAction>(
        isExpanded: true,
        initialValue: value,
        decoration: InputDecoration(labelText: label, isDense: true),
        items: [for (final a in choices) DropdownMenuItem(value: a, child: Text(a.label))],
        onChanged: (v) => v == null ? null : onChanged(v),
      ),
    );
  }

  Widget _buildRuleRow(BuildContext context, _RuleRow row) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 10,
            runSpacing: 10,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              SizedBox(
                width: 130,
                child: DropdownButtonFormField<FirewallAction>(
                  isExpanded: true,
                  initialValue: row.action,
                  decoration: const InputDecoration(labelText: 'Action', isDense: true),
                  items: [for (final a in FirewallAction.values) DropdownMenuItem(value: a, child: Text(a.label))],
                  onChanged: (v) => setState(() => row.action = v ?? row.action),
                ),
              ),
              SizedBox(
                width: 130,
                child: DropdownButtonFormField<FirewallDirection>(
                  isExpanded: true,
                  initialValue: row.direction,
                  decoration: const InputDecoration(labelText: 'Direction', isDense: true),
                  items: [for (final d in FirewallDirection.values) DropdownMenuItem(value: d, child: Text(d.label))],
                  onChanged: (v) => setState(() => row.direction = v ?? row.direction),
                ),
              ),
              SizedBox(
                width: 130,
                child: DropdownButtonFormField<FirewallProtocol>(
                  isExpanded: true,
                  initialValue: row.protocol,
                  decoration: const InputDecoration(labelText: 'Protocol', isDense: true),
                  items: [for (final p in FirewallProtocol.values) DropdownMenuItem(value: p, child: Text(p.label))],
                  onChanged: (v) => setState(() => row.protocol = v ?? row.protocol),
                ),
              ),
              IconButton(
                tooltip: 'Remove rule',
                icon: const Icon(Icons.delete_outline),
                onPressed: () => _removeRow(row.id),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              SizedBox(
                width: 130,
                child: TextField(
                  controller: row.portController,
                  decoration: const InputDecoration(labelText: 'Port / range', hintText: '22 or 8000-8010', isDense: true),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              SizedBox(
                width: 200,
                child: TextField(
                  controller: row.sourceController,
                  decoration: const InputDecoration(labelText: 'Source (CIDR)', hintText: 'any, 10.0.0.0/8', isDense: true),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              SizedBox(
                width: 220,
                child: TextField(
                  controller: row.commentController,
                  decoration: const InputDecoration(labelText: 'Comment', isDense: true),
                  onChanged: (_) => setState(() {}),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// A generation error (bad port/CIDR/etc). Distinct from the SSH lockout
  /// banner below — this means the script could not be built at all.
  Widget _buildErrorBanner(BuildContext context, String message) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: scheme.errorContainer, borderRadius: BorderRadius.circular(12)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline, color: scheme.onErrorContainer, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(message, style: TextStyle(color: scheme.onErrorContainer, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }

  /// Non-fatal advisories from the core, most severe first. A critical entry
  /// (the SSH lockout check) gets the error-red treatment; a set that is
  /// caution-only gets a visible but less alarming tertiary treatment. Either
  /// way this is a colored banner, never plain body text — see the class doc
  /// comment for why.
  Widget _buildWarningBanner(BuildContext context, FirewallScriptResult result) {
    final scheme = Theme.of(context).colorScheme;
    final critical = result.hasCriticalWarning;
    final bg = critical ? scheme.errorContainer : scheme.tertiaryContainer;
    final fg = critical ? scheme.onErrorContainer : scheme.onTertiaryContainer;

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12), border: Border.all(color: fg.withValues(alpha: 0.3))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(critical ? Icons.warning_amber_rounded : Icons.info_outline, color: fg, size: 20),
              const SizedBox(width: 8),
              Text(
                critical ? 'LOCKOUT RISK' : 'Advisories',
                style: TextStyle(color: fg, fontWeight: FontWeight.w800, letterSpacing: 0.3),
              ),
            ],
          ),
          const SizedBox(height: 8),
          for (final warning in result.warnings)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(warning.message, style: TextStyle(color: fg, fontWeight: warning.severity == FirewallWarningSeverity.critical ? FontWeight.w600 : FontWeight.normal)),
            ),
        ],
      ),
    );
  }
}
