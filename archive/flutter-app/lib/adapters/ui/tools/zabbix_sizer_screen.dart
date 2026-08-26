import 'package:flutter/material.dart';

import '../../../core/tuning/zabbix_sizer.dart';
import '../shell/app_theme.dart';
import '../shell/tool_detail_scaffold.dart';

/// Zabbix monitoring capacity/sizing screen: given host/item counts, poll
/// interval and retention windows, generates NVPS, recommended
/// `zabbix_server.conf` worker/cache values, and a database growth estimate
/// via [ZabbixSizer]. Built on the shared [ToolDetailScaffold] split layout,
/// mirroring [lib/adapters/ui/tools/db_memory_sizer_screen.dart]'s numeric
/// -inputs-in / breakdown-out shape.
class ZabbixSizerScreen extends StatefulWidget {
  const ZabbixSizerScreen({super.key});

  @override
  State<ZabbixSizerScreen> createState() => _ZabbixSizerScreenState();
}

class _ZabbixSizerScreenState extends State<ZabbixSizerScreen> {
  static const _useCase = ZabbixSizer();

  final _hostCountController = TextEditingController(text: '200');
  final _itemsPerHostController = TextEditingController(text: '80');
  final _intervalController = TextEditingController(text: '60');
  final _historyDaysController = TextEditingController(text: '7');
  final _trendsDaysController = TextEditingController(text: '365');
  final _cpuCoresController = TextEditingController(text: '8');

  ZabbixDbEngine _dbEngine = ZabbixDbEngine.postgresql;

  ZabbixSizerResult? _result;
  String? _errorText;

  @override
  void initState() {
    super.initState();
    _recompute();
    for (final controller in [
      _hostCountController,
      _itemsPerHostController,
      _intervalController,
      _historyDaysController,
      _trendsDaysController,
      _cpuCoresController,
    ]) {
      controller.addListener(_recompute);
    }
  }

  @override
  void dispose() {
    _hostCountController.dispose();
    _itemsPerHostController.dispose();
    _intervalController.dispose();
    _historyDaysController.dispose();
    _trendsDaysController.dispose();
    _cpuCoresController.dispose();
    super.dispose();
  }

  void _recompute() {
    final hostCount = int.tryParse(_hostCountController.text.trim());
    final itemsPerHost = int.tryParse(_itemsPerHostController.text.trim());
    final interval = double.tryParse(_intervalController.text.trim());
    final historyDays = int.tryParse(_historyDaysController.text.trim());
    final trendsDays = int.tryParse(_trendsDaysController.text.trim());
    final cpuCores = int.tryParse(_cpuCoresController.text.trim());

    if (hostCount == null ||
        itemsPerHost == null ||
        interval == null ||
        historyDays == null ||
        trendsDays == null ||
        cpuCores == null) {
      setState(() {
        _result = null;
        _errorText = 'All fields must be numbers (whole numbers, except interval '
            'which may have a decimal).';
      });
      return;
    }

    try {
      final result = _useCase.execute(
        ZabbixSizerInput(
          hostCount: hostCount,
          itemsPerHost: itemsPerHost,
          checkIntervalSeconds: interval,
          historyRetentionDays: historyDays,
          trendsRetentionDays: trendsDays,
          dbEngine: _dbEngine,
          cpuCores: cpuCores,
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
    } catch (e) {
      // Defensive net: never let an unexpected exception from the core
      // reach the widget tree.
      setState(() {
        _result = null;
        _errorText = 'Could not compute a sizing estimate: $e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'Zabbix Monitoring Sizer',
      copyText: _result?.configText,
      inputPanel: _buildInputPanel(context),
      outputPanel: _buildOutputPanel(context),
    );
  }

  // ------------------------------------------------------------------
  // Input panel
  // ------------------------------------------------------------------

  Widget _buildInputPanel(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Monitored environment', style: theme.textTheme.titleMedium),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _numberField(
                controller: _hostCountController,
                label: 'Hosts',
                integer: true,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _numberField(
                controller: _itemsPerHostController,
                label: 'Items per host',
                integer: true,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        _numberField(
          controller: _intervalController,
          label: 'Check interval (seconds)',
          helperText: 'Average item refresh rate',
          integer: false,
        ),
        const SizedBox(height: 20),
        Text('Housekeeping retention', style: theme.textTheme.titleMedium),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _numberField(
                controller: _historyDaysController,
                label: 'History retention (days)',
                integer: true,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _numberField(
                controller: _trendsDaysController,
                label: 'Trends retention (days)',
                integer: true,
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),
        Text('Server', style: theme.textTheme.titleMedium),
        const SizedBox(height: 12),
        _numberField(
          controller: _cpuCoresController,
          label: 'CPU cores on Zabbix server',
          helperText: 'StartPreprocessors is floored at this value',
          integer: true,
        ),
        const SizedBox(height: 12),
        Text('Database engine', style: theme.textTheme.titleSmall),
        const SizedBox(height: 8),
        SegmentedButton<ZabbixDbEngine>(
          segments: const [
            ButtonSegment(
              value: ZabbixDbEngine.postgresql,
              label: Text('PostgreSQL'),
              icon: Icon(Icons.storage),
            ),
            ButtonSegment(
              value: ZabbixDbEngine.mysql,
              label: Text('MySQL / MariaDB'),
              icon: Icon(Icons.dns),
            ),
          ],
          selected: {_dbEngine},
          onSelectionChanged: (selection) {
            setState(() => _dbEngine = selection.first);
            _recompute();
          },
        ),
        if (_errorText != null) ...[
          const SizedBox(height: 16),
          _noticeCard(
            context,
            icon: Icons.error_outline,
            background: scheme.errorContainer,
            foreground: scheme.onErrorContainer,
            text: _errorText!,
          ),
        ],
      ],
    );
  }

  Widget _numberField({
    required TextEditingController controller,
    required String label,
    required bool integer,
    String? helperText,
  }) {
    return TextField(
      controller: controller,
      keyboardType: TextInputType.numberWithOptions(decimal: !integer),
      decoration: InputDecoration(
        labelText: label,
        helperText: helperText,
        border: const OutlineInputBorder(),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Output panel
  // ------------------------------------------------------------------

  Widget _buildOutputPanel(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final result = _result;

    if (result == null) {
      return Text(
        'Enter positive host/item counts, interval and retention windows to '
        'see a sizing estimate.',
        style: theme.textTheme.bodyMedium,
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _nvpsHero(context, result),
        const SizedBox(height: 20),
        Text('Recommended workers', style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        _breakdownCard(context, [
          _BreakdownRow('StartPollers', '${result.startPollers}'),
          _BreakdownRow('StartPollersUnreachable', '${result.startPollersUnreachable}'),
          _BreakdownRow('StartPreprocessors', '${result.startPreprocessors}'),
          _BreakdownRow('StartTrappers', '${result.startTrappers}'),
          _BreakdownRow('StartDBSyncers', '${result.startDbSyncers}'),
        ]),
        const SizedBox(height: 16),
        Text('Recommended caches', style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        _breakdownCard(context, [
          _BreakdownRow('CacheSize', '${result.cacheSizeMb} MB'),
          _BreakdownRow('HistoryCacheSize', '${result.historyCacheSizeMb} MB'),
          _BreakdownRow('HistoryIndexCacheSize', '${result.historyIndexCacheSizeMb} MB'),
          _BreakdownRow('TrendCacheSize', '${result.trendCacheSizeMb} MB'),
          _BreakdownRow('ValueCacheSize', '${result.valueCacheSizeMb} MB'),
        ]),
        const SizedBox(height: 16),
        Text('Database growth estimate', style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        _breakdownCard(context, [
          _BreakdownRow('History growth / day', formatZabbixBytes(result.historyBytesPerDay)),
          _BreakdownRow(
            'History total (${_days(result.historyBytesTotal, result.historyBytesPerDay)}d retention)',
            formatZabbixBytes(result.historyBytesTotal),
          ),
          _BreakdownRow('Trend rows / day', result.trendRowsPerDay.toStringAsFixed(0)),
          _BreakdownRow('Trends growth / day', formatZabbixBytes(result.trendsBytesPerDay)),
          _BreakdownRow('Trends total', formatZabbixBytes(result.trendsBytesTotal)),
          _BreakdownRow(
            'Engine overhead (${result.dbEngine.label})',
            '${result.engineOverheadFactor.toStringAsFixed(2)}x',
          ),
          _BreakdownRow('Estimated total DB size', formatZabbixBytes(result.totalDbBytes), emphasize: true),
        ]),
        const SizedBox(height: 20),
        Text('zabbix_server.conf', style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: SizedBox(
              width: double.infinity,
              child: SelectableText(result.configText, style: AppTheme.monospace),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'Cache and worker figures are heuristic starting points (see '
          'ZabbixSizer doc comment) — verify against the internal items '
          'Zabbix exposes once the server is running, e.g. '
          'zabbix[wcache,values], zabbix[vcache,buffer,pfree].',
          style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
      ],
    );
  }

  /// Days-of-retention label helper for the "History total" row — avoids
  /// threading the raw input controller value through just for display.
  String _days(double totalBytes, double perDayBytes) {
    if (perDayBytes <= 0) return '0';
    return (totalBytes / perDayBytes).round().toString();
  }

  Widget _nvpsHero(BuildContext context, ZabbixSizerResult result) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Card(
      color: scheme.primaryContainer.withValues(alpha: 0.45),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'NVPS (New Values Per Second)',
                    style: theme.textTheme.labelMedium?.copyWith(color: scheme.onPrimaryContainer),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    result.nvps.toStringAsFixed(2),
                    style: theme.textTheme.headlineSmall?.copyWith(color: scheme.onPrimaryContainer),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '${result.totalItems} total items',
                    style: theme.textTheme.bodySmall?.copyWith(color: scheme.onPrimaryContainer),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _breakdownCard(BuildContext context, List<_BreakdownRow> rows) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Column(
          children: [
            for (var i = 0; i < rows.length; i++) ...[
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        rows[i].label,
                        style: rows[i].emphasize
                            ? theme.textTheme.titleSmall
                            : theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ),
                    Text(
                      rows[i].value,
                      style: (rows[i].emphasize ? theme.textTheme.titleSmall : theme.textTheme.bodyMedium)
                          ?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                    ),
                  ],
                ),
              ),
              if (i != rows.length - 1) Divider(height: 1, color: scheme.outlineVariant.withValues(alpha: 0.6)),
            ],
          ],
        ),
      ),
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

class _BreakdownRow {
  const _BreakdownRow(this.label, this.value, {this.emphasize = false});

  final String label;
  final String value;
  final bool emphasize;
}
