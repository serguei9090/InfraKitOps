import 'package:flutter/material.dart';

import '../../../core/tuning/db_memory_sizer.dart';
import '../shell/app_theme.dart';
import '../shell/tool_detail_scaffold.dart';

enum _DbEngine { postgres, mariadb }

/// "Database Memory Sizer" tool screen: given total system RAM, the share
/// of it reserved for the database, and the expected connection count,
/// generates recommended memory-related config lines for PostgreSQL and
/// MariaDB/MySQL via [DbMemorySizer]. Built on the shared
/// [ToolDetailScaffold] split layout.
class DbMemorySizerScreen extends StatefulWidget {
  const DbMemorySizerScreen({super.key});

  @override
  State<DbMemorySizerScreen> createState() => _DbMemorySizerScreenState();
}

class _DbMemorySizerScreenState extends State<DbMemorySizerScreen> {
  static const _useCase = DbMemorySizer();

  final _totalRamController = TextEditingController(text: '16');
  final _maxConnectionsController = TextEditingController(text: '100');

  double _percentForDatabase = 100;
  _DbEngine _selectedEngine = _DbEngine.postgres;

  DbMemorySizerResult? _result;
  String? _errorText;

  @override
  void initState() {
    super.initState();
    _recompute();
    _totalRamController.addListener(_recompute);
    _maxConnectionsController.addListener(_recompute);
  }

  @override
  void dispose() {
    _totalRamController.dispose();
    _maxConnectionsController.dispose();
    super.dispose();
  }

  void _recompute() {
    final totalRamGb = double.tryParse(_totalRamController.text.trim());
    final maxConnections = int.tryParse(_maxConnectionsController.text.trim());

    if (totalRamGb == null || maxConnections == null) {
      setState(() {
        _result = null;
        _errorText = 'Total RAM must be a number and max connections a whole number';
      });
      return;
    }

    try {
      final result = _useCase.execute(
        DbMemorySizerInput(
          totalRamGb: totalRamGb,
          maxConnections: maxConnections,
          percentForDatabase: _percentForDatabase,
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

  String? get _configText {
    final result = _result;
    if (result == null) return null;
    return _selectedEngine == _DbEngine.postgres ? result.postgres.configText : result.mariadb.configText;
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'Database Memory Sizer',
      copyText: _configText,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('System resources', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          TextField(
            controller: _totalRamController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: 'Total system RAM (GB)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _maxConnectionsController,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'max_connections',
              helperText: 'Expected concurrent connections; drives the work_mem split',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 20),
          Text(
            'Percent of RAM available to the database: '
            '${_percentForDatabase.round()}%',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          Text(
            'Use 100% for a dedicated database server, or lower it when the box '
            'is shared with other services.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          Slider(
            value: _percentForDatabase,
            min: 10,
            max: 100,
            divisions: 18,
            label: '${_percentForDatabase.round()}%',
            onChanged: (value) {
              setState(() => _percentForDatabase = value);
              _recompute();
            },
          ),
          const SizedBox(height: 12),
          Text('Engine', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          SegmentedButton<_DbEngine>(
            segments: const [
              ButtonSegment(
                value: _DbEngine.postgres,
                label: Text('PostgreSQL'),
                icon: Icon(Icons.storage),
              ),
              ButtonSegment(
                value: _DbEngine.mariadb,
                label: Text('MariaDB / MySQL'),
                icon: Icon(Icons.dns),
              ),
            ],
            selected: {_selectedEngine},
            onSelectionChanged: (selection) => setState(() => _selectedEngine = selection.first),
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
          Text(
            _selectedEngine == _DbEngine.postgres ? 'postgresql.conf' : 'my.cnf',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 12),
          if (_result == null)
            Text(
              'Enter a positive RAM value and a positive max_connections to see '
              'recommended settings.',
              style: Theme.of(context).textTheme.bodyMedium,
            )
          else ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: SelectableText(_configText ?? '', style: AppTheme.monospace),
              ),
            ),
            const SizedBox(height: 20),
            if (_selectedEngine == _DbEngine.postgres)
              Text(
                'shared_buffers ~= 25% of usable RAM; effective_cache_size ~= 75% '
                '(a planner hint, not a real allocation); work_mem splits the '
                'remaining RAM across max_connections then divides by a safety '
                'factor of 4, since a single query can allocate work_mem several '
                'times over for sorts and hashes. These are heuristic starting '
                'points, not a substitute for real workload tuning.',
                style: Theme.of(context).textTheme.bodySmall,
              )
            else
              Text(
                'innodb_buffer_pool_size ~= 75% of usable RAM, within the standard '
                '70-80% guidance for a dedicated InnoDB server. A heuristic '
                'starting point, not a substitute for real workload tuning.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
          ],
        ],
      ),
    );
  }
}
