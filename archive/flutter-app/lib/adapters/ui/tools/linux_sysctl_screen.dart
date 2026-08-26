import 'package:flutter/material.dart';

import '../../../core/tuning/linux_sysctl_tuner.dart';
import '../shell/app_theme.dart';
import '../shell/tool_detail_scaffold.dart';

/// Screen for the Linux Kernel Sysctl tuner, built on the shared
/// [ToolDetailScaffold] split-panel layout: interface profile / BBR / TIME_WAIT
/// reuse / SYN backlog / socket memory controls on the left, the generated
/// `/etc/sysctl.d/99-network-performance.conf` text on the right.
class LinuxSysctlScreen extends StatefulWidget {
  const LinuxSysctlScreen({super.key});

  @override
  State<LinuxSysctlScreen> createState() => _LinuxSysctlScreenState();
}

class _LinuxSysctlScreenState extends State<LinuxSysctlScreen> {
  static const LinuxSysctlTuner _tuner = LinuxSysctlTuner();

  NetworkInterfaceProfile _profile = NetworkInterfaceProfile.tenGigabit;
  bool _enableBbr = true;
  bool _enableTimeWaitReuse = true;
  double _synBacklog = 8192;
  double _socketMemoryGb = 16;

  LinuxSysctlResult? _result;
  String? _errorText;

  @override
  void initState() {
    super.initState();
    _regenerate();
  }

  void _regenerate() {
    try {
      final result = _tuner.execute(
        LinuxSysctlInput(
          interfaceProfile: _profile,
          enableBbr: _enableBbr,
          enableTimeWaitReuse: _enableTimeWaitReuse,
          synBacklog: _synBacklog.round(),
          socketMemoryGb: _socketMemoryGb.round(),
        ),
      );
      setState(() {
        _result = result;
        _errorText = null;
      });
    } on ArgumentError catch (e) {
      setState(() {
        _result = null;
        _errorText = e.message?.toString() ?? 'Invalid input';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'Linux Kernel Sysctl',
      copyText: _result?.configText,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Network Interface Speed Profile',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          RadioGroup<NetworkInterfaceProfile>(
            groupValue: _profile,
            onChanged: (value) {
              if (value == null) return;
              setState(() => _profile = value);
              _regenerate();
            },
            child: Column(
              children: [
                for (final profile in NetworkInterfaceProfile.values)
                  RadioListTile<NetworkInterfaceProfile>(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: Text(profile.description),
                    value: profile,
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Enable BBR Congestion Control'),
            subtitle: const Text('Toggles fq + tcp_bbr modules'),
            value: _enableBbr,
            onChanged: (value) {
              setState(() => _enableBbr = value);
              _regenerate();
            },
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Enable TIME_WAIT Socket Reuse'),
            value: _enableTimeWaitReuse,
            onChanged: (value) {
              setState(() => _enableTimeWaitReuse = value);
              _regenerate();
            },
          ),
          const SizedBox(height: 12),
          Text(
            'TCP SYN Backlog Queue Size: ${_synBacklog.round()}',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          Slider(
            value: _synBacklog,
            min: LinuxSysctlTuner.minSynBacklog.toDouble(),
            max: LinuxSysctlTuner.maxSynBacklog.toDouble(),
            divisions: (LinuxSysctlTuner.maxSynBacklog -
                    LinuxSysctlTuner.minSynBacklog) ~/
                64,
            label: _synBacklog.round().toString(),
            onChanged: (value) => setState(() => _synBacklog = value),
            onChangeEnd: (_) => _regenerate(),
          ),
          Text(
            '(Min: ${LinuxSysctlTuner.minSynBacklog}, Max: ${LinuxSysctlTuner.maxSynBacklog})',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          Text(
            'System Memory Allocated for Sockets (GB): ${_socketMemoryGb.round()}',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          Slider(
            value: _socketMemoryGb,
            min: LinuxSysctlTuner.minSocketMemoryGb.toDouble(),
            max: 256,
            divisions: 255,
            label: '${_socketMemoryGb.round()} GB',
            onChanged: (value) => setState(() => _socketMemoryGb = value),
            onChangeEnd: (_) => _regenerate(),
          ),
          Text(
            '(Min: ${LinuxSysctlTuner.minSocketMemoryGb} GB, Max: ${LinuxSysctlTuner.maxSocketMemoryGb} GB)',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (_errorText != null) ...[
            const SizedBox(height: 12),
            Text(
              _errorText!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
        ],
      ),
      outputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Generated sysctl configuration',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: Theme.of(context).colorScheme.outlineVariant,
              ),
            ),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: SelectableText(
                _result?.configText ??
                    'Adjust the inputs to generate a sysctl configuration.',
                style: AppTheme.monospace,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
