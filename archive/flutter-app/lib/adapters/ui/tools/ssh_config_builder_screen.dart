import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/utility/ssh_config_builder.dart';
import '../shell/app_theme.dart';
import '../shell/file_drop_field.dart';
import '../shell/tool_detail_scaffold.dart';

/// OpenSSH config builder screen: generates either a client `~/.ssh/config`
/// or a server `sshd_config`.
///
/// The whole input panel is generated from [kSshOptionCatalog] — each
/// [SshOption]'s [SshValueKind] decides whether it renders as a switch, a
/// dropdown of its legal values, a number field, or a free-text field. Adding
/// a directive is therefore a one-entry change in the core catalog with no
/// widget work here.
///
/// Only directives the user ticked are passed to [SshConfigBuilder], so the
/// generated file stays a small reviewable diff instead of a restatement of
/// OpenSSH's defaults.
class SshConfigBuilderScreen extends StatefulWidget {
  const SshConfigBuilderScreen({super.key});

  @override
  State<SshConfigBuilderScreen> createState() => _SshConfigBuilderScreenState();
}

/// Editing state for one selectable directive set (a Host block, the `Host *`
/// defaults, or the whole sshd_config).
///
/// A key present in [values] means "selected"; absent means the directive is
/// omitted from the output entirely. Text controllers are created lazily and
/// kept alive so typing survives rebuilds of unrelated rows.
class _DirectiveSet {
  _DirectiveSet({String pattern = ''}) : patternController = TextEditingController(text: pattern);

  /// Only used by named client Host blocks; ignored elsewhere.
  final TextEditingController patternController;

  final Map<String, String> values = {};
  final Map<String, TextEditingController> _controllers = {};

  TextEditingController controllerFor(SshOption option) {
    return _controllers.putIfAbsent(
      option.key,
      () => TextEditingController(text: values[option.key] ?? ''),
    );
  }

  bool isSelected(SshOption option) => values.containsKey(option.key);

  /// Seeds an initial value when a directive is first ticked: the hardened
  /// pick if there is one, else OpenSSH's own default, else the first legal
  /// enum value (so a dropdown never starts on an illegal blank).
  String seedFor(SshOption option) {
    final typed = _controllers[option.key]?.text.trim();
    if (typed != null && typed.isNotEmpty) return typed;
    final seed = option.hardenedValue ?? option.defaultValue;
    if (seed != null && seed.isNotEmpty) return seed;
    return switch (option.kind) {
      SshValueKind.boolean => 'no',
      SshValueKind.choice => option.allowedValues.first,
      SshValueKind.integer => option.hint ?? '0',
      SshValueKind.freeText => '',
    };
  }

  void select(SshOption option, String value) {
    values[option.key] = value;
    if (option.kind == SshValueKind.freeText || option.kind == SshValueKind.integer) {
      final controller = controllerFor(option);
      if (controller.text != value) controller.text = value;
    }
  }

  void deselect(SshOption option) => values.remove(option.key);

  void clear() => values.clear();

  /// Applies [preset], replacing any current selection.
  void applyPreset(SshConfigMode mode, Map<String, String> preset) {
    values.clear();
    for (final entry in preset.entries) {
      final option = sshOptionFor(mode, entry.key);
      if (option == null) continue;
      select(option, entry.value);
    }
  }

  void dispose() {
    patternController.dispose();
    for (final controller in _controllers.values) {
      controller.dispose();
    }
  }
}

class _SshConfigBuilderScreenState extends State<SshConfigBuilderScreen> {
  static const SshConfigBuilder _builder = SshConfigBuilder();

  SshConfigMode _mode = SshConfigMode.client;

  /// Client mode: named `Host` blocks, in file order.
  final List<_DirectiveSet> _hostBlocks = [_DirectiveSet(pattern: 'example-host')];

  /// Client mode: the trailing `Host *` defaults block.
  final _DirectiveSet _globals = _DirectiveSet();

  /// Server mode: the flat sshd_config directive set.
  final _DirectiveSet _server = _DirectiveSet();

  String? _saveMessage;
  String? _saveError;

  @override
  void dispose() {
    for (final block in _hostBlocks) {
      block.dispose();
    }
    _globals.dispose();
    _server.dispose();
    super.dispose();
  }

  // ------------------------------------------------------------------
  // Generation
  // ------------------------------------------------------------------

  /// Runs the core builder, converting every possible failure into inline
  /// text. Nothing thrown in here is allowed to reach the widget tree.
  ({String? text, String? error, List<String> warnings}) _generate() {
    try {
      final input = _mode == SshConfigMode.client
          ? SshConfigBuilderInput(
              mode: SshConfigMode.client,
              hostBlocks: [
                for (final block in _hostBlocks)
                  SshHostBlock(pattern: block.patternController.text, values: Map.of(block.values)),
              ],
              globalDefaults: Map.of(_globals.values),
            )
          : SshConfigBuilderInput(mode: SshConfigMode.server, serverValues: Map.of(_server.values));

      final result = _builder.execute(input);
      return (text: result.configText, error: null, warnings: result.warnings);
    } on ArgumentError catch (e) {
      return (text: null, error: e.message?.toString() ?? e.toString(), warnings: const <String>[]);
    } on FormatException catch (e) {
      return (text: null, error: e.message, warnings: const <String>[]);
    } catch (e) {
      return (text: null, error: 'Could not generate the config: $e', warnings: const <String>[]);
    }
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  void _applyHardenedPreset() {
    setState(() {
      _saveMessage = null;
      _saveError = null;
      final preset = sshHardenedBaseline(_mode);
      if (_mode == SshConfigMode.client) {
        _globals.applyPreset(SshConfigMode.client, preset);
      } else {
        _server.applyPreset(SshConfigMode.server, preset);
      }
    });
  }

  void _clearAll() {
    setState(() {
      _saveMessage = null;
      _saveError = null;
      if (_mode == SshConfigMode.client) {
        _globals.clear();
        for (final block in _hostBlocks) {
          block.clear();
        }
      } else {
        _server.clear();
      }
    });
  }

  void _addHostBlock() {
    setState(() => _hostBlocks.add(_DirectiveSet(pattern: 'host-${_hostBlocks.length + 1}')));
  }

  void _removeHostBlock(int index) {
    setState(() => _hostBlocks.removeAt(index).dispose());
  }

  Future<void> _save(String text) async {
    setState(() {
      _saveMessage = null;
      _saveError = null;
    });
    try {
      final path = await saveBytesWithDialog(
        bytes: Uint8List.fromList(utf8.encode(text)),
        suggestedName: _mode.suggestedFileName,
        mimeType: 'text/plain',
      );
      if (!mounted) return;
      setState(() {
        _saveMessage = path == null ? null : 'Saved to $path';
        if (path != null && _mode == SshConfigMode.client) {
          _saveMessage = '$_saveMessage — remember: chmod 600';
        }
      });
    } catch (e) {
      if (mounted) setState(() => _saveError = 'Could not save the file: $e');
    }
  }

  Future<void> _copy(String text) async {
    try {
      await Clipboard.setData(ClipboardData(text: text));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Copied to clipboard'), duration: Duration(seconds: 1)),
      );
    } catch (e) {
      if (mounted) setState(() => _saveError = 'Could not copy: $e');
    }
  }

  // ------------------------------------------------------------------
  // Build
  // ------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final generated = _generate();

    return ToolDetailScaffold(
      title: 'OpenSSH Config Builder',
      copyText: generated.text,
      inputPanel: _buildInputPanel(context),
      outputPanel: _buildOutputPanel(context, generated),
    );
  }

  Widget _buildInputPanel(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SegmentedButton<SshConfigMode>(
          segments: const [
            ButtonSegment(
              value: SshConfigMode.client,
              icon: Icon(Icons.laptop_mac, size: 18),
              label: Text('Client'),
            ),
            ButtonSegment(
              value: SshConfigMode.server,
              icon: Icon(Icons.dns_outlined, size: 18),
              label: Text('Server'),
            ),
          ],
          selected: {_mode},
          onSelectionChanged: (selection) => setState(() {
            _mode = selection.first;
            _saveMessage = null;
            _saveError = null;
          }),
        ),
        const SizedBox(height: 6),
        Text(
          _mode == SshConfigMode.client
              ? 'ssh_config(5) — per-user ~/.ssh/config, made of Host blocks.'
              : 'sshd_config(5) — the daemon config, a flat list of directives.',
          style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 16),
        _buildPresetCard(context),
        const SizedBox(height: 16),
        if (_mode == SshConfigMode.client) ..._buildClientSections(context) else _buildServerSection(context),
      ],
    );
  }

  Widget _buildPresetCard(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Card(
      color: scheme.secondaryContainer.withValues(alpha: 0.35),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.shield_outlined, size: 18, color: scheme.onSecondaryContainer),
                const SizedBox(width: 8),
                Text('Hardened baseline', style: theme.textTheme.titleSmall),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              _mode == SshConfigMode.client
                  ? 'Pre-selects researched secure defaults into the Host * block: keys only, no agent/X11 '
                        'forwarding, hashed known_hosts, and modern crypto (no ssh-rsa/SHA-1, no CBC, no SHA-1 MACs).'
                  : 'Pre-selects researched secure defaults: no root login, keys only, forwarding off, '
                        'idle timeouts, VERBOSE logging, and modern crypto (no ssh-rsa/SHA-1, no CBC, no SHA-1 MACs).',
              style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(Icons.warning_amber_outlined, size: 16, color: scheme.error),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'A starting point, not a finished config. Verify every directive against YOUR OpenSSH version '
                    '(ssh -V, ssh -Q kex, ssh -Q cipher, ssh -Q mac) — naming an unknown algorithm makes sshd '
                    'refuse to start. Always run sshd -t and keep an existing session open while testing.',
                    style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.tonalIcon(
                  onPressed: _applyHardenedPreset,
                  icon: const Icon(Icons.auto_fix_high, size: 18),
                  label: const Text('Apply hardened baseline'),
                ),
                OutlinedButton.icon(
                  onPressed: _clearAll,
                  icon: const Icon(Icons.backspace_outlined, size: 18),
                  label: const Text('Clear all'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildClientSections(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return [
      Text('Host blocks', style: theme.textTheme.titleMedium),
      const SizedBox(height: 4),
      Text(
        'One block per server or pattern. Patterns may be space-separated, e.g. "web-* db-*".',
        style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
      ),
      const SizedBox(height: 10),
      for (var i = 0; i < _hostBlocks.length; i++) ...[
        _buildHostBlockCard(context, i),
        const SizedBox(height: 10),
      ],
      OutlinedButton.icon(
        onPressed: _addHostBlock,
        icon: const Icon(Icons.add, size: 18),
        label: const Text('Add Host block'),
      ),
      const SizedBox(height: 22),
      Text('Global defaults (Host *)', style: theme.textTheme.titleMedium),
      const SizedBox(height: 4),
      Text(
        'Applied to every connection. Emitted last, because ssh_config is first-match-wins: a Host * '
        'block at the top would shadow the specific blocks below it.',
        style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
      ),
      const SizedBox(height: 10),
      Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          child: Column(children: _buildGroupTiles(context, _globals, SshConfigMode.client)),
        ),
      ),
    ];
  }

  Widget _buildHostBlockCard(BuildContext context, int index) {
    final theme = Theme.of(context);
    final block = _hostBlocks[index];
    final selectedCount = block.values.length;

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: block.patternController,
                    style: AppTheme.monospace,
                    decoration: const InputDecoration(
                      labelText: 'Host pattern',
                      hintText: 'web-01',
                      isDense: true,
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                if (_hostBlocks.length > 1)
                  IconButton(
                    tooltip: 'Remove this Host block',
                    icon: const Icon(Icons.delete_outline, size: 20),
                    onPressed: () => _removeHostBlock(index),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              selectedCount == 0 ? 'No directives selected yet' : '$selectedCount directive(s) selected',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            ..._buildGroupTiles(context, block, SshConfigMode.client),
          ],
        ),
      ),
    );
  }

  Widget _buildServerSection(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('sshd_config directives', style: theme.textTheme.titleMedium),
        const SizedBox(height: 10),
        Card(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Column(children: _buildGroupTiles(context, _server, SshConfigMode.server)),
          ),
        ),
      ],
    );
  }

  /// One [ExpansionTile] per catalog group, each holding that group's rows.
  /// Entirely data-driven — no group or directive is named here.
  List<Widget> _buildGroupTiles(BuildContext context, _DirectiveSet set, SshConfigMode mode) {
    final theme = Theme.of(context);
    final tiles = <Widget>[];

    for (final group in sshGroupsForMode(mode)) {
      final options = sshOptionsInGroup(mode, group);
      if (options.isEmpty) continue;
      final selected = options.where(set.isSelected).length;

      tiles.add(
        ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 8),
          childrenPadding: const EdgeInsets.only(left: 4, right: 4, bottom: 8),
          initiallyExpanded: selected > 0,
          title: Text(group, style: theme.textTheme.titleSmall),
          subtitle: Text(
            selected == 0 ? '${options.length} available' : '$selected of ${options.length} selected',
            style: theme.textTheme.bodySmall?.copyWith(
              color: selected == 0 ? theme.colorScheme.onSurfaceVariant : theme.colorScheme.primary,
            ),
          ),
          children: [for (final option in options) _buildOptionRow(context, set, option)],
        ),
      );
    }
    return tiles;
  }

  /// A single directive row: an include checkbox plus the editor its
  /// [SshValueKind] calls for. Options with a closed value set never get a
  /// free-text field.
  Widget _buildOptionRow(BuildContext context, _DirectiveSet set, SshOption option) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final selected = set.isSelected(option);

    void toggle(bool? checked) {
      setState(() {
        if (checked ?? false) {
          set.select(option, set.seedFor(option));
        } else {
          set.deselect(option);
        }
        _saveMessage = null;
      });
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 32,
                child: Checkbox(value: selected, onChanged: toggle, visualDensity: VisualDensity.compact),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    InkWell(
                      onTap: () => toggle(!selected),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        child: Row(
                          children: [
                            Flexible(
                              child: Text(
                                option.key,
                                style: AppTheme.monospace.copyWith(
                                  fontWeight: FontWeight.w600,
                                  color: selected ? scheme.onSurface : scheme.onSurfaceVariant,
                                ),
                              ),
                            ),
                            if (option.hardenedValue != null) ...[
                              const SizedBox(width: 6),
                              Icon(Icons.shield_outlined, size: 13, color: scheme.primary),
                            ],
                          ],
                        ),
                      ),
                    ),
                    Text(
                      option.description,
                      style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                    if (option.defaultValue != null || option.versionNote != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        [
                          if (option.defaultValue != null) 'OpenSSH default: ${option.defaultValue}',
                          if (option.versionNote != null) option.versionNote!,
                        ].join('  ·  '),
                        style: theme.textTheme.labelSmall?.copyWith(color: scheme.outline),
                      ),
                    ],
                    if (selected) ...[
                      const SizedBox(height: 8),
                      _buildEditor(context, set, option),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildEditor(BuildContext context, _DirectiveSet set, SshOption option) {
    final theme = Theme.of(context);
    final current = set.values[option.key] ?? '';

    switch (option.kind) {
      case SshValueKind.boolean:
        final on = current.toLowerCase() == 'yes';
        return Row(
          children: [
            Switch(
              value: on,
              onChanged: (value) => setState(() => set.select(option, value ? 'yes' : 'no')),
            ),
            const SizedBox(width: 8),
            Text(on ? 'yes' : 'no', style: AppTheme.monospace),
          ],
        );

      case SshValueKind.choice:
        // Guard against a stale/illegal value ever reaching the dropdown.
        final value = option.allowedValues.contains(current) ? current : option.allowedValues.first;
        if (value != current) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) setState(() => set.select(option, value));
          });
        }
        return DropdownButtonFormField<String>(
          isExpanded: true,
          initialValue: value,
          isDense: true,
          decoration: const InputDecoration(isDense: true),
          style: AppTheme.monospace.copyWith(color: theme.colorScheme.onSurface),
          items: [
            for (final allowed in option.allowedValues)
              DropdownMenuItem(value: allowed, child: Text(allowed, style: AppTheme.monospace)),
          ],
          onChanged: (selection) {
            if (selection == null) return;
            setState(() => set.select(option, selection));
          },
        );

      case SshValueKind.integer:
        return TextField(
          controller: set.controllerFor(option),
          keyboardType: TextInputType.number,
          style: AppTheme.monospace,
          decoration: InputDecoration(
            hintText: option.hint,
            isDense: true,
            helperText: option.minValue != null && option.maxValue != null
                ? '${option.minValue}–${option.maxValue}'
                : null,
          ),
          onChanged: (value) => setState(() => set.values[option.key] = value),
        );

      case SshValueKind.freeText:
        final warnings = option.group == 'Cryptography' ? sshDeprecatedAlgorithmsIn(current) : const <String>[];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: set.controllerFor(option),
              style: AppTheme.monospace,
              maxLines: null,
              decoration: InputDecoration(hintText: option.hint, isDense: true),
              onChanged: (value) => setState(() => set.values[option.key] = value),
            ),
            if (warnings.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                'Deprecated / broken: ${warnings.join(', ')}',
                style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.error),
              ),
            ],
          ],
        );
    }
  }

  // ------------------------------------------------------------------
  // Output panel
  // ------------------------------------------------------------------

  Widget _buildOutputPanel(
    BuildContext context,
    ({String? text, String? error, List<String> warnings}) generated,
  ) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    if (generated.error != null) {
      return _noticeCard(
        context,
        icon: Icons.error_outline,
        background: scheme.errorContainer,
        foreground: scheme.onErrorContainer,
        text: generated.error!,
      );
    }

    final text = generated.text;
    if (text == null) {
      return Text(
        'Tick some directives on the left to generate a config.',
        style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                _mode == SshConfigMode.client ? 'Generated ~/.ssh/config' : 'Generated sshd_config',
                style: theme.textTheme.titleMedium,
              ),
            ),
            IconButton(
              tooltip: 'Copy',
              icon: const Icon(Icons.copy, size: 18),
              onPressed: () => _copy(text),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton.icon(
              onPressed: () => _save(text),
              icon: const Icon(Icons.save_alt, size: 18),
              label: Text('Save as "${_mode.suggestedFileName}"'),
            ),
          ],
        ),
        if (_saveMessage != null) ...[
          const SizedBox(height: 8),
          Text(_saveMessage!, style: theme.textTheme.bodySmall?.copyWith(color: scheme.primary)),
        ],
        if (_saveError != null) ...[
          const SizedBox(height: 8),
          Text(_saveError!, style: theme.textTheme.bodySmall?.copyWith(color: scheme.error)),
        ],
        for (final warning in generated.warnings) ...[
          const SizedBox(height: 10),
          _noticeCard(
            context,
            icon: Icons.warning_amber_outlined,
            background: scheme.tertiaryContainer,
            foreground: scheme.onTertiaryContainer,
            text: warning,
          ),
        ],
        const SizedBox(height: 14),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: SizedBox(
              width: double.infinity,
              child: SelectableText(text, style: AppTheme.monospace),
            ),
          ),
        ),
      ],
    );
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
