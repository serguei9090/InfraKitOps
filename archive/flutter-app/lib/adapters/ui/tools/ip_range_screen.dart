import 'package:flutter/material.dart';

import '../../../core/utility/ip_range_tool.dart';
import '../shell/app_theme.dart';
import '../shell/tool_detail_scaffold.dart';

enum _Mode { rangeToCidr, cidrToRange, ulaGenerate }

/// "IP Range / CIDR Tool" screen: summarize an inclusive IPv4 range into the
/// minimal set of CIDR blocks that cover it, expand a single CIDR block back
/// into its range, or generate an RFC 4193-shaped IPv6 Unique Local Address
/// prefix.
///
/// Built on the shared [ToolDetailScaffold] split-panel layout. Every
/// [IpRangeTool] call is wrapped so a [FormatException] / [ArgumentError]
/// becomes inline text rather than an uncaught exception.
class IpRangeScreen extends StatefulWidget {
  const IpRangeScreen({super.key});

  @override
  State<IpRangeScreen> createState() => _IpRangeScreenState();
}

class _IpRangeScreenState extends State<IpRangeScreen> {
  static const _tool = IpRangeTool();

  _Mode _mode = _Mode.rangeToCidr;

  // Range -> CIDR
  final _startController = TextEditingController(text: '192.168.1.5');
  final _endController = TextEditingController(text: '192.168.1.10');
  Ipv4RangeResult? _rangeResult;
  String? _rangeError;

  // CIDR -> range
  final _cidrController = TextEditingController(text: '192.168.1.0/24');
  CidrBlock? _cidrResult;
  String? _cidrError;

  // IPv6 ULA
  final _subnetIdController = TextEditingController();
  UlaPrefixResult? _ulaResult;
  String? _ulaError;

  @override
  void initState() {
    super.initState();
    _startController.addListener(_runRangeToCidr);
    _endController.addListener(_runRangeToCidr);
    _cidrController.addListener(_runCidrToRange);
    _runRangeToCidr();
    _runCidrToRange();
  }

  @override
  void dispose() {
    _startController.dispose();
    _endController.dispose();
    _cidrController.dispose();
    _subnetIdController.dispose();
    super.dispose();
  }

  String _messageOf(Object e) {
    if (e is ArgumentError) return e.message?.toString() ?? e.toString();
    if (e is FormatException) return e.message;
    return e.toString();
  }

  void _runRangeToCidr() {
    setState(() {
      final start = _startController.text.trim();
      final end = _endController.text.trim();
      if (start.isEmpty || end.isEmpty) {
        _rangeResult = null;
        _rangeError = null;
        return;
      }
      try {
        _rangeResult = _tool.summarizeRange(start, end);
        _rangeError = null;
      } catch (e) {
        _rangeResult = null;
        _rangeError = _messageOf(e);
      }
    });
  }

  void _runCidrToRange() {
    setState(() {
      final cidr = _cidrController.text.trim();
      if (cidr.isEmpty) {
        _cidrResult = null;
        _cidrError = null;
        return;
      }
      try {
        _cidrResult = _tool.expandCidr(cidr);
        _cidrError = null;
      } catch (e) {
        _cidrResult = null;
        _cidrError = _messageOf(e);
      }
    });
  }

  void _runUlaGenerate() {
    setState(() {
      try {
        final text = _subnetIdController.text.trim();
        final subnetId = text.isEmpty ? null : int.tryParse(text);
        if (text.isNotEmpty && subnetId == null) {
          _ulaError = 'Subnet ID must be a whole number (0-65535).';
          _ulaResult = null;
          return;
        }
        _ulaResult = _tool.generateUla(subnetId: subnetId);
        _ulaError = null;
      } catch (e) {
        _ulaResult = null;
        _ulaError = _messageOf(e);
      }
    });
  }

  String? _copyText() {
    switch (_mode) {
      case _Mode.rangeToCidr:
        final r = _rangeResult;
        if (r == null) return null;
        final buffer = StringBuffer()
          ..writeln('Range: ${r.startAddress} - ${r.endAddress}')
          ..writeln('Total addresses: ${r.totalAddresses}')
          ..writeln('CIDR blocks (${r.blocks.length}):');
        for (final b in r.blocks) {
          buffer.writeln('  ${b.cidr}  (${b.firstAddress} - ${b.lastAddress}, ${b.addressCount} addresses)');
        }
        return buffer.toString().trimRight();
      case _Mode.cidrToRange:
        final c = _cidrResult;
        if (c == null) return null;
        return [
          'CIDR: ${c.cidr}',
          'Network address: ${c.networkAddress}',
          'First address: ${c.firstAddress}',
          'Last address: ${c.lastAddress}',
          'Address count: ${c.addressCount}',
        ].join('\n');
      case _Mode.ulaGenerate:
        final u = _ulaResult;
        if (u == null) return null;
        return [
          'Global ID: ${u.globalIdHex}',
          'Site prefix: ${u.prefix48}',
          'Subnet ID: ${u.subnetId}',
          'Subnet /64: ${u.subnet64}',
          'Example host address: ${u.exampleAddress}',
        ].join('\n');
    }
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'IP Range / CIDR Tool',
      copyText: _copyText(),
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Mode', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ChoiceChip(
                label: const Text('Range → CIDR'),
                selected: _mode == _Mode.rangeToCidr,
                onSelected: (_) => setState(() => _mode = _Mode.rangeToCidr),
              ),
              ChoiceChip(
                label: const Text('CIDR → range'),
                selected: _mode == _Mode.cidrToRange,
                onSelected: (_) => setState(() => _mode = _Mode.cidrToRange),
              ),
              ChoiceChip(
                label: const Text('IPv6 ULA generate'),
                selected: _mode == _Mode.ulaGenerate,
                onSelected: (_) => setState(() => _mode = _Mode.ulaGenerate),
              ),
            ],
          ),
          const SizedBox(height: 20),
          switch (_mode) {
            _Mode.rangeToCidr => _buildRangeControls(context),
            _Mode.cidrToRange => _buildCidrControls(context),
            _Mode.ulaGenerate => _buildUlaControls(context),
          },
        ],
      ),
      outputPanel: switch (_mode) {
        _Mode.rangeToCidr => _buildRangeOutput(context),
        _Mode.cidrToRange => _buildCidrOutput(context),
        _Mode.ulaGenerate => _buildUlaOutput(context),
      },
    );
  }

  // -------------------------------------------------------- range -> CIDR

  Widget _buildRangeControls(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Start address', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _startController,
          style: const TextStyle(fontFamily: 'monospace'),
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: '192.168.1.5'),
        ),
        const SizedBox(height: 16),
        Text('End address', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _endController,
          style: const TextStyle(fontFamily: 'monospace'),
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: '192.168.1.10'),
        ),
        const SizedBox(height: 8),
        Text(
          'Computes the minimal set of CIDR blocks that exactly tiles this inclusive range.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }

  Widget _buildRangeOutput(BuildContext context) {
    if (_rangeError != null) return _ErrorCard(message: _rangeError!);
    final r = _rangeResult;
    if (r == null) return const Text('Enter a start and end address to summarize the range.');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SelectableText('Total addresses: ${r.totalAddresses}', style: AppTheme.monospace),
        const SizedBox(height: 4),
        SelectableText('Blocks: ${r.blocks.length}', style: AppTheme.monospace),
        const SizedBox(height: 12),
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: SelectableText(
              r.blocks
                  .map((b) => '${b.cidr.padRight(20)}${b.firstAddress} - ${b.lastAddress}  (${b.addressCount})')
                  .join('\n'),
              style: AppTheme.monospace,
            ),
          ),
        ),
      ],
    );
  }

  // -------------------------------------------------------- CIDR -> range

  Widget _buildCidrControls(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('CIDR block', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _cidrController,
          style: const TextStyle(fontFamily: 'monospace'),
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: '192.168.1.0/24'),
        ),
        const SizedBox(height: 8),
        Text(
          'A host part that is not already zeroed is masked down to the network address.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }

  Widget _buildCidrOutput(BuildContext context) {
    if (_cidrError != null) return _ErrorCard(message: _cidrError!);
    final c = _cidrResult;
    if (c == null) return const Text('Enter a CIDR block, e.g. 192.168.1.0/24.');

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _FieldRow(label: 'CIDR', value: c.cidr),
            _FieldRow(label: 'Network address', value: c.networkAddress),
            _FieldRow(label: 'First address', value: c.firstAddress),
            _FieldRow(label: 'Last address', value: c.lastAddress),
            _FieldRow(label: 'Address count', value: '${c.addressCount}'),
          ],
        ),
      ),
    );
  }

  // ------------------------------------------------------------ IPv6 ULA

  Widget _buildUlaControls(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Subnet ID (optional)', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _subnetIdController,
          keyboardType: TextInputType.number,
          style: const TextStyle(fontFamily: 'monospace'),
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: 'Leave blank for a random subnet ID (0-65535)',
          ),
        ),
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: _runUlaGenerate,
          icon: const Icon(Icons.auto_awesome),
          label: const Text('Generate'),
        ),
        const SizedBox(height: 8),
        Text(
          'RFC 4193-shaped, not an RFC-exact derivation: the 40-bit Global ID is drawn from a '
          'secure random source rather than the RFC\'s EUI-64 + timestamp + SHA-1 ritual, which '
          'gives the same collision properties without needing a hardware MAC address.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }

  Widget _buildUlaOutput(BuildContext context) {
    if (_ulaError != null) return _ErrorCard(message: _ulaError!);
    final u = _ulaResult;
    if (u == null) return const Text('Press Generate to mint an IPv6 ULA prefix.');

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _FieldRow(label: 'Global ID', value: u.globalIdHex),
            _FieldRow(label: 'Site prefix (/48)', value: u.prefix48),
            _FieldRow(label: 'Subnet ID', value: '${u.subnetId}'),
            _FieldRow(label: 'Subnet (/64)', value: u.subnet64),
            _FieldRow(label: 'Example host address', value: u.exampleAddress),
          ],
        ),
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
          SizedBox(width: 150, child: Text(label, style: Theme.of(context).textTheme.labelLarge)),
          const SizedBox(width: 12),
          Expanded(child: SelectableText(value, style: AppTheme.monospace)),
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
