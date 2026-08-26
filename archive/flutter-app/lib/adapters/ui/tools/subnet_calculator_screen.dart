import 'package:flutter/material.dart';

import '../../../core/utility/subnet_calculator.dart';
import '../shell/tool_detail_scaffold.dart';

/// "IPv4/IPv6 Subnet Calculator" tool screen (spec section 2.4).
///
/// Left panel: a single CIDR text input (e.g. "10.0.0.0/22" or
/// "2001:db8::/64"). Right panel: every computed field for the detected IP
/// version, laid out as labeled rows, with a toolbar copy button for the
/// full summary. Built entirely on the shared [ToolDetailScaffold] so it
/// stays visually consistent with every other tool screen.
class SubnetCalculatorScreen extends StatefulWidget {
  const SubnetCalculatorScreen({super.key});

  @override
  State<SubnetCalculatorScreen> createState() => _SubnetCalculatorScreenState();
}

class _SubnetCalculatorScreenState extends State<SubnetCalculatorScreen> {
  static const _useCase = SubnetCalculator();

  final _cidrController = TextEditingController(text: '192.168.1.0/24');

  SubnetCalculatorResult? _result;
  String? _error;

  @override
  void initState() {
    super.initState();
    _recompute();
    _cidrController.addListener(_recompute);
  }

  @override
  void dispose() {
    _cidrController.dispose();
    super.dispose();
  }

  void _recompute() {
    setState(() {
      final cidr = _cidrController.text;
      if (cidr.trim().isEmpty) {
        _result = null;
        _error = null;
        return;
      }
      try {
        _result = _useCase.execute(SubnetCalculatorInput(cidr: cidr));
        _error = null;
      } catch (e) {
        _result = null;
        _error = _messageOf(e);
      }
    });
  }

  String _messageOf(Object e) {
    if (e is ArgumentError) return e.message?.toString() ?? e.toString();
    if (e is FormatException) return e.message;
    return e.toString();
  }

  String _summaryOf(SubnetCalculatorResult r) {
    final buffer = StringBuffer();
    buffer.writeln('CIDR: ${_cidrController.text.trim()}');
    buffer.writeln('IP version: ${r.version == IpVersion.v4 ? 'IPv4' : 'IPv6'}');
    buffer.writeln('Prefix length: /${r.prefixLength}');
    buffer.writeln('Network address: ${r.networkAddress}');
    if (r.version == IpVersion.v4) {
      buffer.writeln('Broadcast address: ${r.broadcastAddress}');
      buffer.writeln('Subnet mask: ${r.subnetMask}');
      buffer.writeln('Wildcard mask: ${r.wildcardMask}');
      buffer.writeln('First usable host: ${r.firstUsableAddress}');
      buffer.writeln('Last usable host: ${r.lastUsableAddress}');
      buffer.writeln('Usable host count: ${r.usableHostCount}');
    } else {
      buffer.writeln('First address: ${r.firstAddress}');
      buffer.writeln('Last address: ${r.lastAddress}');
    }
    buffer.writeln('Total address count: ${r.totalAddressCount}');
    return buffer.toString().trimRight();
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    return ToolDetailScaffold(
      title: 'IPv4/IPv6 Subnet Calculator',
      copyText: result == null ? null : _summaryOf(result),
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('CIDR block', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(
            controller: _cidrController,
            style: const TextStyle(fontFamily: 'monospace'),
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'e.g. 192.168.1.0/24 or 2001:db8::/64',
              prefixIcon: Icon(Icons.lan_outlined),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Enter an IPv4 or IPv6 address with a "/" prefix length. The IP '
            'version is detected automatically from the address format.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
      outputPanel: _buildOutput(context),
    );
  }

  Widget _buildOutput(BuildContext context) {
    if (_error != null) {
      return Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error));
    }
    final result = _result;
    if (result == null) {
      return Text('Enter a CIDR block to see subnet details.', style: Theme.of(context).textTheme.bodyMedium);
    }

    final rows = <Widget>[
      _FieldRow(label: 'IP version', value: result.version == IpVersion.v4 ? 'IPv4' : 'IPv6'),
      _FieldRow(label: 'Prefix length', value: '/${result.prefixLength}'),
      _FieldRow(label: 'Network address', value: result.networkAddress),
    ];

    if (result.version == IpVersion.v4) {
      rows.addAll([
        _FieldRow(label: 'Broadcast address', value: result.broadcastAddress!),
        _FieldRow(label: 'Subnet mask', value: result.subnetMask!),
        _FieldRow(label: 'Wildcard mask', value: result.wildcardMask!),
        _FieldRow(label: 'First usable host', value: result.firstUsableAddress!),
        _FieldRow(label: 'Last usable host', value: result.lastUsableAddress!),
        _FieldRow(label: 'Usable host count', value: '${result.usableHostCount}'),
      ]);
    } else {
      rows.addAll([
        _FieldRow(label: 'First address', value: result.firstAddress),
        _FieldRow(label: 'Last address', value: result.lastAddress),
      ]);
    }

    rows.add(_FieldRow(label: 'Total address count', value: '${result.totalAddressCount}'));

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: rows),
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
          SizedBox(
            width: 150,
            child: Text(label, style: Theme.of(context).textTheme.labelLarge),
          ),
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
