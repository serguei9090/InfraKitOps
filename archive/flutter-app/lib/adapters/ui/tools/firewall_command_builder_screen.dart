import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/config/firewall_command_builder.dart';
import '../../../core/config/firewall_rule_builder.dart' show PortRange, FirewallDirection, FirewallProtocol, FirewallWarningSeverity, kFirewallServicePresets;
import '../shell/app_theme.dart';
import '../shell/tool_detail_scaffold.dart';

/// Firewall Command Builder: per-rule one-liners across Linux (iptables /
/// firewalld / ufw), Windows (PowerShell / netsh) and cloud (AWS / GCP /
/// Azure), each rendered as an apply command and its matching undo command.
///
/// This is deliberately separate from the Config Builders module's Firewall
/// Rule Builder, which renders a whole `ufw`/`nftables` policy script. This
/// screen answers "what's the one command to run right now" rather than
/// "generate me a firewall config file".
class FirewallCommandBuilderScreen extends StatefulWidget {
  const FirewallCommandBuilderScreen({super.key});

  @override
  State<FirewallCommandBuilderScreen> createState() => _FirewallCommandBuilderScreenState();
}

class _RuleRow {
  _RuleRow({required this.id, this.action = FirewallCmdAction.allow});

  final int id;
  FirewallCmdAction action;
  FirewallDirection direction = FirewallDirection.inbound;
  FirewallProtocol protocol = FirewallProtocol.tcp;
  final portController = TextEditingController();
  final sourceController = TextEditingController();
  final nameController = TextEditingController();
  final priorityController = TextEditingController();
  final commentController = TextEditingController();

  void dispose() {
    portController.dispose();
    sourceController.dispose();
    nameController.dispose();
    priorityController.dispose();
    commentController.dispose();
  }
}

class _FirewallCommandBuilderScreenState extends State<FirewallCommandBuilderScreen> {
  static const _builder = FirewallCommandBuilder();

  FirewallCmdProvider _provider = FirewallCmdProvider.iptables;
  final _groupIdController = TextEditingController();
  final _resourceGroupController = TextEditingController();
  final _nsgNameController = TextEditingController();
  final _networkController = TextEditingController();

  int _nextId = 0;
  final List<_RuleRow> _rows = [];

  @override
  void initState() {
    super.initState();
    _addRow(port: '22', source: '0.0.0.0/0', comment: 'ssh');
  }

  @override
  void dispose() {
    _groupIdController.dispose();
    _resourceGroupController.dispose();
    _nsgNameController.dispose();
    _networkController.dispose();
    for (final row in _rows) {
      row.dispose();
    }
    super.dispose();
  }

  void _addRow({FirewallCmdAction action = FirewallCmdAction.allow, String port = '', String source = '', String comment = ''}) {
    setState(() {
      final row = _RuleRow(id: _nextId++, action: action);
      row.portController.text = port;
      row.sourceController.text = source;
      row.commentController.text = comment;
      _rows.add(row);
    });
  }

  void _removeRow(int id) {
    setState(() {
      final row = _rows.firstWhere((r) => r.id == id);
      row.dispose();
      _rows.removeWhere((r) => r.id == id);
    });
  }

  ({FirewallCmdRule rule, FirewallCommand? command, String? error}) _generate(_RuleRow row) {
    try {
      final rule = FirewallCmdRule(
        action: row.action,
        direction: row.direction,
        protocol: row.protocol,
        ports: row.portController.text.trim().isEmpty ? null : PortRange.parse(row.portController.text.trim()),
        source: row.sourceController.text.trim().isEmpty ? null : row.sourceController.text.trim(),
        ruleName: row.nameController.text.trim().isEmpty ? null : row.nameController.text.trim(),
        priority: int.tryParse(row.priorityController.text.trim()),
        comment: row.commentController.text.trim().isEmpty ? null : row.commentController.text.trim(),
      );
      final context = FirewallCmdContext(
        provider: _provider,
        groupId: _groupIdController.text.trim(),
        resourceGroup: _resourceGroupController.text.trim(),
        nsgName: _nsgNameController.text.trim(),
        network: _networkController.text.trim(),
      );
      return (rule: rule, command: _builder.build(rule, context), error: null);
    } catch (e) {
      final message = e is ArgumentError ? (e.message?.toString() ?? e.toString()) : e.toString();
      return (rule: FirewallCmdRule(action: row.action), command: null, error: message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final generated = [for (final row in _rows) _generate(row)];
    final copyText = generated.where((g) => g.command != null).map((g) => g.command!.addCommand).join('\n');

    return ToolDetailScaffold(
      title: 'Firewall Command Builder',
      copyText: copyText.isEmpty ? null : copyText,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Target', style: textTheme.titleMedium),
          const SizedBox(height: 8),
          DropdownButtonFormField<FirewallCmdProvider>(
            isExpanded: true,
            initialValue: _provider,
            decoration: const InputDecoration(isDense: true),
            items: [
              for (final p in FirewallCmdProvider.values)
                DropdownMenuItem(value: p, child: Text('${p.group} — ${p.label}')),
            ],
            onChanged: (v) => setState(() => _provider = v ?? _provider),
          ),
          const SizedBox(height: 4),
          Text(_provider.description, style: textTheme.bodySmall),
          if (_provider.needsGroupContext) ...[
            const SizedBox(height: 12),
            _buildContextFields(),
          ],
          const SizedBox(height: 20),

          Text('Quick-add a common service', style: textTheme.titleMedium),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final preset in kFirewallServicePresets)
                OutlinedButton.icon(
                  onPressed: () => _addRow(port: '${preset.port}', source: '0.0.0.0/0', comment: preset.label),
                  icon: const Icon(Icons.add, size: 16),
                  label: Text(preset.label),
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
              child: Text('No rules yet — add one above.', style: textTheme.bodySmall),
            ),
          for (final row in _rows) _buildRuleRow(context, row),
        ],
      ),
      outputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Generated commands', style: textTheme.titleMedium),
          const SizedBox(height: 12),
          if (generated.isEmpty)
            Text('Add a rule to see its commands here.', style: textTheme.bodySmall)
          else
            for (var i = 0; i < _rows.length; i++) _buildOutputCard(context, _rows[i], generated[i]),
        ],
      ),
    );
  }

  Widget _buildContextFields() {
    switch (_provider) {
      case FirewallCmdProvider.awsSecurityGroup:
        return SizedBox(
          width: 280,
          child: TextField(
            controller: _groupIdController,
            decoration: const InputDecoration(labelText: 'Security group ID', hintText: 'sg-0123456789abcdef0', isDense: true),
            onChanged: (_) => setState(() {}),
          ),
        );
      case FirewallCmdProvider.gcpFirewall:
        return SizedBox(
          width: 280,
          child: TextField(
            controller: _networkController,
            decoration: const InputDecoration(labelText: 'VPC network', hintText: 'default', isDense: true),
            onChanged: (_) => setState(() {}),
          ),
        );
      case FirewallCmdProvider.azureNsg:
        return Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            SizedBox(
              width: 200,
              child: TextField(
                controller: _resourceGroupController,
                decoration: const InputDecoration(labelText: 'Resource group', hintText: 'my-resource-group', isDense: true),
                onChanged: (_) => setState(() {}),
              ),
            ),
            SizedBox(
              width: 200,
              child: TextField(
                controller: _nsgNameController,
                decoration: const InputDecoration(labelText: 'NSG name', hintText: 'my-nsg', isDense: true),
                onChanged: (_) => setState(() {}),
              ),
            ),
          ],
        );
      default:
        return const SizedBox.shrink();
    }
  }

  Widget _buildRuleRow(BuildContext context, _RuleRow row) {
    final scheme = Theme.of(context).colorScheme;
    final actions = _provider.supportsDeny ? FirewallCmdAction.values : [FirewallCmdAction.allow];
    if (!_provider.supportsDeny && row.action == FirewallCmdAction.deny) {
      row.action = FirewallCmdAction.allow;
    }

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
                child: DropdownButtonFormField<FirewallCmdAction>(
                  isExpanded: true,
                  initialValue: row.action,
                  decoration: const InputDecoration(labelText: 'Action', isDense: true),
                  items: [for (final a in actions) DropdownMenuItem(value: a, child: Text(a.label))],
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
              if (_provider.needsRuleName)
                SizedBox(
                  width: 200,
                  child: TextField(
                    controller: row.nameController,
                    decoration: const InputDecoration(labelText: 'Rule name', hintText: 'auto-generated if blank', isDense: true),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
              if (_provider.needsPriority)
                SizedBox(
                  width: 110,
                  child: TextField(
                    controller: row.priorityController,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Priority', hintText: '100', isDense: true),
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

  Widget _buildOutputCard(BuildContext context, _RuleRow row, ({FirewallCmdRule rule, FirewallCommand? command, String? error}) generated) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final label = row.commentController.text.trim().isEmpty ? 'Rule' : row.commentController.text.trim();

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: textTheme.labelLarge),
          const SizedBox(height: 8),
          if (generated.error != null)
            Text(generated.error!, style: TextStyle(color: scheme.error, fontWeight: FontWeight.w600))
          else if (generated.command != null) ...[
            for (final warning in generated.command!.warnings) _buildWarningBanner(context, warning.message, warning.severity),
            _buildCommandLine(context, 'Add', generated.command!.addCommand),
            const SizedBox(height: 8),
            _buildCommandLine(context, 'Remove', generated.command!.deleteCommand),
          ],
        ],
      ),
    );
  }

  Widget _buildWarningBanner(BuildContext context, String message, FirewallWarningSeverity severity) {
    final scheme = Theme.of(context).colorScheme;
    final critical = severity == FirewallWarningSeverity.critical;
    final bg = critical ? scheme.errorContainer : scheme.tertiaryContainer;
    final fg = critical ? scheme.onErrorContainer : scheme.onTertiaryContainer;

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, color: fg, size: 18),
          const SizedBox(width: 8),
          Expanded(child: Text(message, style: TextStyle(color: fg))),
        ],
      ),
    );
  }

  Widget _buildCommandLine(BuildContext context, String label, String command) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant)),
        const SizedBox(height: 4),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              Expanded(
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: SelectableText(command, style: AppTheme.monospace),
                ),
              ),
              IconButton(
                tooltip: 'Copy "$label" command',
                icon: const Icon(Icons.copy, size: 16),
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: command));
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Copied "$label" command'), duration: const Duration(seconds: 1)),
                    );
                  }
                },
              ),
            ],
          ),
        ),
      ],
    );
  }
}
