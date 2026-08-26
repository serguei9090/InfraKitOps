import 'package:flutter/material.dart';

import '../../../core/tuning/ceph_pg_calculator.dart';
import '../shell/app_theme.dart';
import '../shell/tool_detail_scaffold.dart';

/// "Ceph PG Calculator" tool screen: left panel takes the cluster's OSD
/// count, pool count, target PGs-per-OSD and replication factor; right
/// panel shows the raw and power-of-2-rounded placement-group count from
/// [CephPgCalculator], built on the shared [ToolDetailScaffold] split
/// layout.
class CephPgScreen extends StatefulWidget {
  const CephPgScreen({super.key});

  @override
  State<CephPgScreen> createState() => _CephPgScreenState();
}

class _CephPgScreenState extends State<CephPgScreen> {
  static const _useCase = CephPgCalculator();

  final _osdCountController = TextEditingController(text: '20');
  final _poolCountController = TextEditingController(text: '1');
  final _targetPgsController = TextEditingController(text: '100');
  final _replicationController = TextEditingController(text: '3');

  CephPgResult? _result;
  String? _errorText;

  @override
  void initState() {
    super.initState();
    _recompute();
    for (final c in [
      _osdCountController,
      _poolCountController,
      _targetPgsController,
      _replicationController,
    ]) {
      c.addListener(_recompute);
    }
  }

  @override
  void dispose() {
    _osdCountController.dispose();
    _poolCountController.dispose();
    _targetPgsController.dispose();
    _replicationController.dispose();
    super.dispose();
  }

  int? _parseInt(String text) => int.tryParse(text.trim());

  void _recompute() {
    final osdCount = _parseInt(_osdCountController.text);
    final poolCount = _parseInt(_poolCountController.text);
    final targetPgsPerOsd = _parseInt(_targetPgsController.text);
    final replicationFactor = _parseInt(_replicationController.text);

    if (osdCount == null || poolCount == null || targetPgsPerOsd == null || replicationFactor == null) {
      setState(() {
        _result = null;
        _errorText = 'All fields must be whole numbers';
      });
      return;
    }

    try {
      final result = _useCase.execute(
        CephPgInput(
          osdCount: osdCount,
          poolCount: poolCount,
          targetPgsPerOsd: targetPgsPerOsd,
          replicationFactor: replicationFactor,
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

  String get _copyText {
    final result = _result;
    if (result == null) return '';
    return 'pg_num = ${result.roundedPgCount}\n'
        '# raw target: ${result.rawPgCount.toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'Ceph PG Calculator',
      copyText: _copyText.isEmpty ? null : _copyText,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Cluster parameters', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          TextField(
            controller: _osdCountController,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'OSD count',
              helperText: 'Total number of OSDs in the cluster',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _poolCountController,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Pool count',
              helperText: 'Number of pools sharing these OSDs',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _targetPgsController,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Target PGs per OSD',
              helperText: 'Ceph recommends ~100 for most clusters',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _replicationController,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Replication factor (size)',
              helperText: 'e.g. 3 for triple replication, 2 for erasure k+m equivalents',
              border: OutlineInputBorder(),
            ),
          ),
          if (_errorText != null) ...[
            const SizedBox(height: 16),
            Text(_errorText!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
        ],
      ),
      outputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Result', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          if (_result == null)
            Text(
              'Enter valid, positive whole numbers to see the recommended PG count.',
              style: Theme.of(context).textTheme.bodyMedium,
            )
          else ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Recommended pg_num', style: Theme.of(context).textTheme.labelLarge),
                    const SizedBox(height: 4),
                    SelectableText(
                      '${_result!.roundedPgCount}',
                      style: AppTheme.monospace.copyWith(fontSize: 28, height: 1.2),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Raw (unrounded) target: ${_result!.rawPgCount.toStringAsFixed(2)}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              'Formula: (OSD count x target PGs per OSD) / replication factor / pool '
              'count, then rounded up to the nearest power of 2 — Ceph\'s official '
              'recommendation, since pg_num must be a power of 2 for even data '
              'distribution across OSDs.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ],
      ),
    );
  }
}
