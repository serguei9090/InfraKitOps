import 'package:flutter/material.dart';

import '../../../core/utility/mac_address_tool.dart';
import '../shell/tool_detail_scaffold.dart';

enum _Mode { analyze, generate }

/// "MAC Address Tool" screen: analyze an existing MAC address (every
/// notation, U/L and I/G flag bits, curated vendor lookup) or generate one
/// or more fresh MAC addresses with chosen flag bits / vendor prefix.
///
/// Built on the shared [ToolDetailScaffold] split-panel layout. All parsing
/// and generation errors from [MacAddressTool] are caught inline — nothing
/// thrown by the core ever reaches the widget tree.
class MacAddressScreen extends StatefulWidget {
  const MacAddressScreen({super.key});

  @override
  State<MacAddressScreen> createState() => _MacAddressScreenState();
}

class _MacAddressScreenState extends State<MacAddressScreen> {
  static const _tool = MacAddressTool();

  _Mode _mode = _Mode.analyze;

  // Analyze mode
  final _macController = TextEditingController(text: '00:1A:2B:3C:4D:5E');
  MacAddressAnalysis? _analyzed;
  String? _analyzeError;

  // Generate mode
  final _countController = TextEditingController(text: '1');
  final _vendorPrefixController = TextEditingController();
  bool _locallyAdministered = true;
  bool _unicast = true;
  List<MacAddressAnalysis> _generated = [];
  String? _generateError;

  @override
  void initState() {
    super.initState();
    _macController.addListener(_runAnalyze);
    _runAnalyze();
  }

  @override
  void dispose() {
    _macController.dispose();
    _countController.dispose();
    _vendorPrefixController.dispose();
    super.dispose();
  }

  void _runAnalyze() {
    setState(() {
      final text = _macController.text;
      if (text.trim().isEmpty) {
        _analyzed = null;
        _analyzeError = null;
        return;
      }
      try {
        _analyzed = _tool.analyze(text);
        _analyzeError = null;
      } catch (e) {
        _analyzed = null;
        _analyzeError = _messageOf(e);
      }
    });
  }

  void _runGenerate() {
    setState(() {
      try {
        final count = int.tryParse(_countController.text.trim());
        if (count == null || count < 1) {
          _generateError = 'Enter a count of at least 1.';
          _generated = [];
          return;
        }
        final prefix = _vendorPrefixController.text.trim();
        _generated = _tool.generate(
          MacGenerationOptions(
            count: count,
            locallyAdministered: _locallyAdministered,
            unicast: _unicast,
            vendorPrefixHex: prefix.isEmpty ? null : prefix,
          ),
        );
        _generateError = null;
      } catch (e) {
        _generated = [];
        _generateError = _messageOf(e);
      }
    });
  }

  String _messageOf(Object e) {
    if (e is ArgumentError) return e.message?.toString() ?? e.toString();
    if (e is FormatException) return e.message;
    return e.toString();
  }

  String? _copyText() {
    if (_mode == _Mode.analyze) {
      final a = _analyzed;
      if (a == null) return null;
      final buffer = StringBuffer()
        ..writeln('Colon:  ${a.colonForm}')
        ..writeln('Hyphen: ${a.hyphenForm}')
        ..writeln('Dotted: ${a.dottedForm}')
        ..writeln('Bare:   ${a.bareForm}')
        ..writeln('OUI:    ${a.ouiDisplay}')
        ..writeln('Locally administered (U/L): ${a.isLocallyAdministered}')
        ..writeln('Multicast (I/G): ${a.isMulticast}')
        ..writeln('Broadcast: ${a.isBroadcast}');
      if (a.vendor != null) buffer.writeln('Vendor (curated match): ${a.vendor!.vendor}');
      return buffer.toString().trimRight();
    }
    if (_generated.isEmpty) return null;
    return _generated.map((a) => a.colonForm).join('\n');
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'MAC Address Tool',
      copyText: _copyText(),
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Mode', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 10),
          SegmentedButton<_Mode>(
            segments: const [
              ButtonSegment(value: _Mode.analyze, label: Text('Analyze'), icon: Icon(Icons.search)),
              ButtonSegment(value: _Mode.generate, label: Text('Generate'), icon: Icon(Icons.auto_awesome)),
            ],
            selected: {_mode},
            onSelectionChanged: (selection) => setState(() => _mode = selection.first),
          ),
          const SizedBox(height: 20),
          if (_mode == _Mode.analyze) ..._buildAnalyzeControls(context) else ..._buildGenerateControls(context),
        ],
      ),
      outputPanel: _mode == _Mode.analyze ? _buildAnalyzeOutput(context) : _buildGenerateOutput(context),
    );
  }

  // ------------------------------------------------------------- analyze

  List<Widget> _buildAnalyzeControls(BuildContext context) {
    return [
      Text('MAC address', style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8),
      TextField(
        controller: _macController,
        style: const TextStyle(fontFamily: 'monospace'),
        decoration: const InputDecoration(
          border: OutlineInputBorder(),
          hintText: '00:1A:2B:3C:4D:5E',
          prefixIcon: Icon(Icons.memory_outlined),
        ),
      ),
      const SizedBox(height: 8),
      Text(
        'Accepts colon (00:1A:2B:3C:4D:5E), hyphen (00-1A-2B-3C-4D-5E), Cisco dotted '
        '(001A.2B3C.4D5E) or bare hex (001A2B3C4D5E) notation.',
        style: Theme.of(context).textTheme.bodySmall,
      ),
    ];
  }

  Widget _buildAnalyzeOutput(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    if (_analyzeError != null) {
      return _ErrorCard(message: _analyzeError!);
    }
    final a = _analyzed;
    if (a == null) {
      return const Text('Enter a MAC address to see its details.');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Every notation', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _FieldRow(label: 'Colon', value: a.colonForm),
                _FieldRow(label: 'Hyphen', value: a.hyphenForm),
                _FieldRow(label: 'Cisco dotted', value: a.dottedForm),
                _FieldRow(label: 'Bare hex', value: a.bareForm),
                _FieldRow(label: 'OUI', value: a.ouiDisplay),
              ],
            ),
          ),
        ),
        const SizedBox(height: 20),
        Text('Flag bits', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            _FlagBadge(
              label: 'U/L bit',
              active: a.isLocallyAdministered,
              activeText: 'Locally administered',
              inactiveText: 'Universally administered (real OUI)',
              activeIcon: Icons.edit_outlined,
              inactiveIcon: Icons.verified_outlined,
            ),
            _FlagBadge(
              label: 'I/G bit',
              active: a.isMulticast,
              activeText: 'Multicast (group)',
              inactiveText: 'Unicast',
              activeIcon: Icons.groups_outlined,
              inactiveIcon: Icons.person_outline,
            ),
            if (a.isBroadcast)
              const _FlagBadge(
                label: 'Special',
                active: true,
                activeText: 'Broadcast address',
                inactiveText: '',
                activeIcon: Icons.campaign_outlined,
                inactiveIcon: Icons.campaign_outlined,
              ),
          ],
        ),
        const SizedBox(height: 20),
        Text('Vendor lookup', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        _VendorCard(vendor: a.vendor, locallyAdministered: a.isLocallyAdministered),
        const SizedBox(height: 10),
        Text(
          'Vendor lookup is a small curated subset (hypervisor/container prefixes plus a '
          'handful of common hardware vendors) — not the full IEEE OUI registry. A miss '
          'only means "not in our small table", never "unassigned".',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
      ],
    );
  }

  // ------------------------------------------------------------- generate

  List<Widget> _buildGenerateControls(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final hasPrefix = _vendorPrefixController.text.trim().isNotEmpty;

    return [
      Text('How many', style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8),
      TextField(
        controller: _countController,
        keyboardType: TextInputType.number,
        decoration: const InputDecoration(
          border: OutlineInputBorder(),
          labelText: 'Count',
          helperText: '1 to 256',
        ),
      ),
      const SizedBox(height: 16),
      Text('Vendor prefix (optional)', style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8),
      TextField(
        controller: _vendorPrefixController,
        onChanged: (_) => setState(() {}),
        style: const TextStyle(fontFamily: 'monospace'),
        decoration: const InputDecoration(
          border: OutlineInputBorder(),
          hintText: 'e.g. 00:50:56 (leave blank for a fully random address)',
        ),
      ),
      const SizedBox(height: 16),
      Text('Flag bits', style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 4),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Locally administered (U/L bit)'),
        subtitle: const Text('Off mints an address that looks like a real IEEE-registered OUI.'),
        value: _locallyAdministered,
        onChanged: hasPrefix ? null : (v) => setState(() => _locallyAdministered = v),
      ),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Unicast'),
        subtitle: const Text('Off sets the I/G bit and mints a multicast address.'),
        value: _unicast,
        onChanged: hasPrefix ? null : (v) => setState(() => _unicast = v),
      ),
      if (hasPrefix)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            'A vendor prefix owns its own flag bits — the switches above are ignored while '
            'a prefix is set.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ),
      const SizedBox(height: 20),
      FilledButton.icon(
        onPressed: _runGenerate,
        icon: const Icon(Icons.auto_awesome),
        label: const Text('Generate'),
      ),
    ];
  }

  Widget _buildGenerateOutput(BuildContext context) {
    if (_generateError != null) {
      return _ErrorCard(message: _generateError!);
    }
    if (_generated.isEmpty) {
      return const Text('Press Generate to mint one or more MAC addresses.');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${_generated.length} address${_generated.length == 1 ? '' : 'es'} generated',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 10),
        ListView.separated(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: _generated.length,
          separatorBuilder: (_, _) => const SizedBox(height: 8),
          itemBuilder: (context, index) => _GeneratedMacTile(analysis: _generated[index]),
        ),
      ],
    );
  }
}

class _GeneratedMacTile extends StatelessWidget {
  const _GeneratedMacTile({required this.analysis});

  final MacAddressAnalysis analysis;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SelectableText(
              analysis.colonForm,
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontFamily: 'monospace'),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _FlagBadge(
                  label: 'U/L',
                  active: analysis.isLocallyAdministered,
                  activeText: 'Locally administered',
                  inactiveText: 'Universally administered',
                  activeIcon: Icons.edit_outlined,
                  inactiveIcon: Icons.verified_outlined,
                  compact: true,
                ),
                _FlagBadge(
                  label: 'I/G',
                  active: analysis.isMulticast,
                  activeText: 'Multicast',
                  inactiveText: 'Unicast',
                  activeIcon: Icons.groups_outlined,
                  inactiveIcon: Icons.person_outline,
                  compact: true,
                ),
                if (analysis.vendor != null)
                  Chip(
                    visualDensity: VisualDensity.compact,
                    avatar: const Icon(Icons.dns_outlined, size: 16),
                    label: Text(analysis.vendor!.vendor),
                    backgroundColor: scheme.secondaryContainer,
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _VendorCard extends StatelessWidget {
  const _VendorCard({required this.vendor, required this.locallyAdministered});

  final OuiEntry? vendor;
  final bool locallyAdministered;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final entry = vendor;

    if (entry == null) {
      return Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.help_outline, color: scheme.onSurfaceVariant),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  locallyAdministered
                      ? 'No vendor lookup — this OUI is locally administered, so it was never '
                          'issued to a real vendor by the IEEE.'
                      : 'Not in the curated table.',
                ),
              ),
            ],
          ),
        ),
      );
    }

    return Card(
      margin: EdgeInsets.zero,
      color: entry.category == OuiCategory.virtualization ? scheme.tertiaryContainer : scheme.secondaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              entry.category == OuiCategory.virtualization ? Icons.cloud_outlined : Icons.dns_outlined,
              color: entry.category == OuiCategory.virtualization
                  ? scheme.onTertiaryContainer
                  : scheme.onSecondaryContainer,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    entry.vendor,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      color: entry.category == OuiCategory.virtualization
                          ? scheme.onTertiaryContainer
                          : scheme.onSecondaryContainer,
                    ),
                  ),
                  Text(
                    entry.category == OuiCategory.virtualization ? 'Virtualization / container NIC' : 'Hardware vendor',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: entry.category == OuiCategory.virtualization
                          ? scheme.onTertiaryContainer
                          : scheme.onSecondaryContainer,
                    ),
                  ),
                  if (entry.note != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      entry.note!,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: entry.category == OuiCategory.virtualization
                            ? scheme.onTertiaryContainer
                            : scheme.onSecondaryContainer,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FlagBadge extends StatelessWidget {
  const _FlagBadge({
    required this.label,
    required this.active,
    required this.activeText,
    required this.inactiveText,
    required this.activeIcon,
    required this.inactiveIcon,
    this.compact = false,
  });

  final String label;
  final bool active;
  final String activeText;
  final String inactiveText;
  final IconData activeIcon;
  final IconData inactiveIcon;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = active ? activeText : inactiveText;
    final color = active ? scheme.errorContainer : scheme.primaryContainer;
    final onColor = active ? scheme.onErrorContainer : scheme.onPrimaryContainer;

    return Container(
      padding: EdgeInsets.symmetric(horizontal: compact ? 8 : 12, vertical: compact ? 4 : 8),
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(10)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(active ? activeIcon : inactiveIcon, size: compact ? 14 : 16, color: onColor),
          const SizedBox(width: 6),
          Text(
            '$label: $text',
            style: (compact ? Theme.of(context).textTheme.labelSmall : Theme.of(context).textTheme.labelLarge)
                ?.copyWith(color: onColor),
          ),
        ],
      ),
    );
  }
}

class _FieldRow extends StatelessWidget {
  const _FieldRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 110, child: Text(label, style: Theme.of(context).textTheme.labelLarge)),
          const SizedBox(width: 12),
          Expanded(
            child: SelectableText(
              value,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontFamily: 'monospace'),
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.info_outline, color: scheme.onErrorContainer),
            const SizedBox(width: 8),
            Expanded(child: Text(message, style: TextStyle(color: scheme.onErrorContainer))),
          ],
        ),
      ),
    );
  }
}
