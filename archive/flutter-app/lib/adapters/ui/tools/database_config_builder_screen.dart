import 'dart:convert';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import '../../../core/config/database_config_builder.dart';
import '../shell/app_theme.dart';
import '../shell/file_drop_field.dart';
import '../shell/tool_detail_scaffold.dart';

/// Database Config Builder: generates a `postgresql.conf` or `my.cnf`
/// `[mysqld]` block from machine metrics (RAM, CPU, workload, storage) plus
/// a small catalog of durability/replication/logging policy switches.
///
/// Two independent value sources drive the output, and the UI reflects that
/// split directly:
///
///  * Metric inputs (left, top) always feed the calculated section of the
///    output — there's nothing to "select" there, changing a slider just
///    changes the computed number.
///  * Policy options (left, bottom) follow the same generic
///    checkbox-selects / kind-picks-the-widget pattern as
///    `sysctl_config_builder_screen.dart`: a fixed-choice option always gets
///    a dropdown, a boolean always gets a switch, and a dependent option
///    (e.g. `archive_command`) only renders once its governing switch is on.
///
/// Every recompute happens inline on `build()` and is wrapped so a bad input
/// (zero RAM, an out-of-range policy value) surfaces as inline error text —
/// never an uncaught exception reaching the widget tree.
class DatabaseConfigBuilderScreen extends StatefulWidget {
  const DatabaseConfigBuilderScreen({super.key});

  @override
  State<DatabaseConfigBuilderScreen> createState() => _DatabaseConfigBuilderScreenState();
}

class _DatabaseConfigBuilderScreenState extends State<DatabaseConfigBuilderScreen> {
  static const _builder = DatabaseConfigBuilder();

  DatabaseEngine _engine = DatabaseEngine.postgresql;

  // --- PostgreSQL metric inputs ---
  double _pgRamMb = 8192;
  int _pgCpuCount = 4;
  final _pgCpuController = TextEditingController(text: '4');
  final _pgVersionController = TextEditingController(text: '17');
  PgWorkloadType _pgDbType = PgWorkloadType.oltp;
  PgStorageType _pgStorageType = PgStorageType.ssd;
  bool _pgMaxConnAuto = true;
  final _pgMaxConnController = TextEditingController(text: '300');
  bool _pgOsIsWindows = false;
  bool _pgDbFitsInRam = false;
  PgReplicationRole _pgReplicationRole = PgReplicationRole.standalone;

  // --- MariaDB metric inputs ---
  double _maRamMb = 8192;
  double _maReservedOsMb = 1024;
  MariaDbStorageType _maStorageType = MariaDbStorageType.ssd;
  MariaDbWorkloadType _maDbType = MariaDbWorkloadType.oltp;
  bool _maOsIsWindows = false;
  final _maMajorController = TextEditingController(text: '10');
  final _maMinorController = TextEditingController(text: '11');

  // --- Policy option selections (one map per engine so switching engines
  // never loses the other engine's choices) ---
  final Map<String, String> _pgPolicyValues = {};
  final Map<String, String> _maPolicyValues = {};

  late final Map<String, TextEditingController> _policyControllers = {
    for (final option in [...kPostgresPolicyCatalog, ...kMariaDbPolicyCatalog])
      '${option.engine.name}:${option.key}': TextEditingController(text: option.defaultValue),
  };

  String? _saveStatus;
  bool _saveWasError = false;

  @override
  void dispose() {
    _pgCpuController.dispose();
    _pgVersionController.dispose();
    _pgMaxConnController.dispose();
    _maMajorController.dispose();
    _maMinorController.dispose();
    for (final c in _policyControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Map<String, String> get _activePolicyValues =>
      _engine == DatabaseEngine.postgresql ? _pgPolicyValues : _maPolicyValues;

  List<DbPolicyOption> get _activeCatalog => dbPolicyOptionsForEngine(_engine);

  /// Builds the config text, or captures whatever went wrong (bad metrics,
  /// an out-of-range policy value) as plain error text. Never lets an
  /// exception escape to the widget tree.
  ({String? text, String? error}) _generate() {
    try {
      final input = _engine == DatabaseEngine.postgresql
          ? DatabaseConfigBuilderInput(
              engine: _engine,
              postgres: PostgresMetrics(
                totalMemoryMb: _pgRamMb.round(),
                cpuCount: _pgCpuCount,
                dbVersion: int.tryParse(_pgVersionController.text.trim()) ?? 17,
                dbType: _pgDbType,
                maxConnections: _pgMaxConnAuto ? null : int.tryParse(_pgMaxConnController.text.trim()),
                storageType: _pgStorageType,
                osIsWindows: _pgOsIsWindows,
                dbFitsInRam: _pgDbFitsInRam,
                replicationRole: _pgReplicationRole,
              ),
              policyValues: Map.of(_pgPolicyValues),
            )
          : DatabaseConfigBuilderInput(
              engine: _engine,
              mariadb: MariaDbMetrics(
                totalMemoryMb: _maRamMb.round(),
                reservedForOsMb: _maReservedOsMb.round(),
                storageType: _maStorageType,
                dbType: _maDbType,
                osIsWindows: _maOsIsWindows,
                majorVersion: int.tryParse(_maMajorController.text.trim()) ?? 10,
                minorVersion: int.tryParse(_maMinorController.text.trim()) ?? 6,
              ),
              policyValues: Map.of(_maPolicyValues),
            );
      return (text: _builder.execute(input), error: null);
    } catch (e) {
      return (text: null, error: e.toString().replaceFirst('ArgumentError: ', ''));
    }
  }

  bool _dependencyMet(DbPolicyOption option) {
    final governingKey = option.dependsOnKey;
    if (governingKey == null) return true;
    final raw = _activePolicyValues[governingKey];
    if (raw == null || raw.trim().isEmpty) return false;
    final required = option.dependsOnValue;
    if (required == null) return true;
    return raw.trim().toLowerCase() == required.toLowerCase();
  }

  void _toggleOption(DbPolicyOption option, bool checked) {
    setState(() {
      final controllerKey = '${option.engine.name}:${option.key}';
      if (checked) {
        _activePolicyValues[option.key] = _policyControllers[controllerKey]!.text;
      } else {
        _activePolicyValues.remove(option.key);
      }
    });
  }

  void _updateOptionValue(DbPolicyOption option, String value) {
    setState(() {
      _activePolicyValues[option.key] = value;
      _policyControllers['${option.engine.name}:${option.key}']?.text = value;
    });
  }

  Future<void> _save(String text) async {
    setState(() => _saveStatus = null);
    try {
      final name = _engine.suggestedFileName;
      final savedTo = await saveBytesWithDialog(
        bytes: utf8.encode(text),
        suggestedName: name,
        mimeType: 'text/plain',
        acceptedTypes: [
          XTypeGroup(label: 'Config', extensions: [_engine == DatabaseEngine.postgresql ? 'conf' : 'cnf']),
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
    final generated = _generate();
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return ToolDetailScaffold(
      title: 'Database Config Builder',
      copyText: generated.text,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Engine', style: textTheme.titleMedium),
          const SizedBox(height: 8),
          SegmentedButton<DatabaseEngine>(
            segments: const [
              ButtonSegment(value: DatabaseEngine.postgresql, label: Text('PostgreSQL'), icon: Icon(Icons.storage_outlined)),
              ButtonSegment(value: DatabaseEngine.mariadb, label: Text('MariaDB'), icon: Icon(Icons.dns_outlined)),
            ],
            selected: {_engine},
            onSelectionChanged: (selection) {
              setState(() {
                _engine = selection.first;
                _saveStatus = null;
              });
            },
          ),
          const SizedBox(height: 20),
          if (_engine == DatabaseEngine.postgresql) _buildPostgresMetrics(context) else _buildMariaDbMetrics(context),
          const SizedBox(height: 24),
          Text('Policy options', style: textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            'Only the options you select appear in the generated file.',
            style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 10),
          for (final section in _sectionsInOrder(_activeCatalog)) _buildPolicySection(context, section),
        ],
      ),
      outputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text('Generated configuration', style: textTheme.titleMedium)),
              OutlinedButton.icon(
                onPressed: generated.text == null ? null : () => _save(generated.text!),
                icon: const Icon(Icons.download, size: 16),
                label: const Text('Save as file'),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Suggested filename: ${_engine.suggestedFileName}',
            style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
          if (_saveStatus != null) ...[
            const SizedBox(height: 8),
            Text(
              _saveStatus!,
              style: textTheme.bodySmall?.copyWith(color: _saveWasError ? scheme.error : scheme.primary),
            ),
          ],
          const SizedBox(height: 8),
          if (generated.error != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: scheme.errorContainer.withValues(alpha: 0.4),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: scheme.error),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.error_outline, size: 18, color: scheme.error),
                  const SizedBox(width: 8),
                  Expanded(child: Text(generated.error!, style: textTheme.bodySmall?.copyWith(color: scheme.error))),
                ],
              ),
            )
          else
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
                child: SelectableText(generated.text ?? '', style: AppTheme.monospace),
              ),
            ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------
  // PostgreSQL metric inputs
  // ---------------------------------------------------------------------

  Widget _buildPostgresMetrics(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Machine & workload', style: textTheme.titleMedium),
        const SizedBox(height: 10),
        Text('Total RAM: ${_pgRamMb.round()} MB', style: textTheme.bodySmall),
        Slider(
          value: _pgRamMb,
          min: 512,
          max: 262144,
          divisions: 511,
          label: '${_pgRamMb.round()} MB',
          onChanged: (v) => setState(() => _pgRamMb = v),
        ),
        Row(
          children: [
            Expanded(
              child: _labeledField(
                context,
                label: 'CPU cores',
                child: TextField(
                  keyboardType: TextInputType.number,
                  controller: _pgCpuController,
                  onChanged: (v) => setState(() => _pgCpuCount = int.tryParse(v.trim()) ?? _pgCpuCount),
                  decoration: const InputDecoration(isDense: true),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _labeledField(
                context,
                label: 'PostgreSQL version',
                child: TextField(
                  keyboardType: TextInputType.number,
                  controller: _pgVersionController,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(isDense: true, hintText: '17'),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        _labeledField(
          context,
          label: 'Workload type',
          child: DropdownButtonFormField<PgWorkloadType>(
            initialValue: _pgDbType,
            isExpanded: true,
            decoration: const InputDecoration(isDense: true),
            items: [for (final t in PgWorkloadType.values) DropdownMenuItem(value: t, child: Text(t.label))],
            onChanged: (v) => setState(() => _pgDbType = v ?? _pgDbType),
          ),
        ),
        const SizedBox(height: 10),
        _labeledField(
          context,
          label: 'Storage type',
          child: DropdownButtonFormField<PgStorageType>(
            initialValue: _pgStorageType,
            isExpanded: true,
            decoration: const InputDecoration(isDense: true),
            items: [for (final t in PgStorageType.values) DropdownMenuItem(value: t, child: Text(t.label))],
            onChanged: (v) => setState(() => _pgStorageType = v ?? _pgStorageType),
          ),
        ),
        const SizedBox(height: 10),
        _labeledField(
          context,
          label: 'Replication role (drives wal_level)',
          child: DropdownButtonFormField<PgReplicationRole>(
            initialValue: _pgReplicationRole,
            isExpanded: true,
            decoration: const InputDecoration(isDense: true),
            items: [for (final r in PgReplicationRole.values) DropdownMenuItem(value: r, child: Text(r.label))],
            onChanged: (v) => setState(() => _pgReplicationRole = v ?? _pgReplicationRole),
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: Text('Max connections', style: textTheme.bodyMedium),
            ),
            Text('Auto', style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
            Switch(
              value: _pgMaxConnAuto,
              onChanged: (v) => setState(() => _pgMaxConnAuto = v),
            ),
          ],
        ),
        if (!_pgMaxConnAuto)
          TextField(
            keyboardType: TextInputType.number,
            controller: _pgMaxConnController,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(isDense: true, hintText: 'e.g. 300'),
          ),
        const SizedBox(height: 4),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Database fits entirely in RAM'),
          subtitle: const Text('Feeds the work_mem multiplier and random_page_cost.'),
          value: _pgDbFitsInRam,
          onChanged: (v) => setState(() => _pgDbFitsInRam = v),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Server runs Windows'),
          subtitle: const Text('Applies the Windows-specific caps and drops effective_io_concurrency.'),
          value: _pgOsIsWindows,
          onChanged: (v) => setState(() => _pgOsIsWindows = v),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------
  // MariaDB metric inputs
  // ---------------------------------------------------------------------

  Widget _buildMariaDbMetrics(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Machine & workload', style: textTheme.titleMedium),
        const SizedBox(height: 10),
        Text('Total RAM: ${_maRamMb.round()} MB', style: textTheme.bodySmall),
        Slider(
          value: _maRamMb,
          min: 512,
          max: 262144,
          divisions: 511,
          label: '${_maRamMb.round()} MB',
          onChanged: (v) => setState(() {
            _maRamMb = v;
            if (_maReservedOsMb >= _maRamMb) _maReservedOsMb = (_maRamMb * 0.15).roundToDouble();
          }),
        ),
        Text(
          'Reserved for OS: ${_maReservedOsMb.round()} MB (${(_maReservedOsMb / _maRamMb * 100).toStringAsFixed(0)}% of total)',
          style: textTheme.bodySmall,
        ),
        Slider(
          value: _maReservedOsMb.clamp(0, _maRamMb - 1),
          min: 0,
          max: (_maRamMb - 1).clamp(1, double.infinity),
          onChanged: (v) => setState(() => _maReservedOsMb = v),
        ),
        _labeledField(
          context,
          label: 'Workload type',
          child: DropdownButtonFormField<MariaDbWorkloadType>(
            initialValue: _maDbType,
            isExpanded: true,
            decoration: const InputDecoration(isDense: true),
            items: [for (final t in MariaDbWorkloadType.values) DropdownMenuItem(value: t, child: Text(t.label))],
            onChanged: (v) => setState(() => _maDbType = v ?? _maDbType),
          ),
        ),
        const SizedBox(height: 10),
        _labeledField(
          context,
          label: 'Storage type',
          child: DropdownButtonFormField<MariaDbStorageType>(
            initialValue: _maStorageType,
            isExpanded: true,
            decoration: const InputDecoration(isDense: true),
            items: [for (final t in MariaDbStorageType.values) DropdownMenuItem(value: t, child: Text(t.label))],
            onChanged: (v) => setState(() => _maStorageType = v ?? _maStorageType),
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _labeledField(
                context,
                label: 'MariaDB major version',
                child: TextField(
                  keyboardType: TextInputType.number,
                  controller: _maMajorController,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(isDense: true, hintText: '10'),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _labeledField(
                context,
                label: 'Minor version',
                child: TextField(
                  keyboardType: TextInputType.number,
                  controller: _maMinorController,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(isDense: true, hintText: '11'),
                ),
              ),
            ),
          ],
        ),
        Text(
          '10.8+ emits innodb_redo_log_capacity; earlier versions emit innodb_log_file_size.',
          style: textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 4),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Server runs Windows'),
          subtitle: const Text('Switches innodb_flush_method from O_DIRECT to unbuffered.'),
          value: _maOsIsWindows,
          onChanged: (v) => setState(() => _maOsIsWindows = v),
        ),
      ],
    );
  }

  Widget _labeledField(BuildContext context, {required String label, required Widget child}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 4),
        child,
      ],
    );
  }

  // ---------------------------------------------------------------------
  // Policy option catalog rendering — generic over DbOptionValueKind
  // ---------------------------------------------------------------------

  List<String> _sectionsInOrder(List<DbPolicyOption> catalog) {
    final seen = <String>[];
    for (final option in catalog) {
      if (!seen.contains(option.section)) seen.add(option.section);
    }
    return seen;
  }

  Widget _buildPolicySection(BuildContext context, String section) {
    final options = _activeCatalog.where((o) => o.section == section && _dependencyMet(o)).toList();
    if (options.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            section,
            style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
          for (final option in options) _buildPolicyRow(context, option),
        ],
      ),
    );
  }

  Widget _buildPolicyRow(BuildContext context, DbPolicyOption option) {
    final scheme = Theme.of(context).colorScheme;
    final checked = _activePolicyValues.containsKey(option.key);

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Checkbox(value: checked, onChanged: (v) => _toggleOption(option, v ?? false)),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        option.label,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: checked ? scheme.primary : scheme.onSurface,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        option.description,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(left: 48, right: 4),
            child: _buildOptionValueEditor(context, option, checked),
          ),
        ],
      ),
    );
  }

  /// Picks the input widget from [DbPolicyOption.kind], the same way
  /// `sysctl_config_builder_screen.dart` does off `SysctlValueKind`: a
  /// fixed-choice option can never receive a free-text value.
  Widget _buildOptionValueEditor(BuildContext context, DbPolicyOption option, bool enabled) {
    final choices = dbEffectiveChoices(option);
    final controllerKey = '${option.engine.name}:${option.key}';

    if (choices.isNotEmpty) {
      final current = _activePolicyValues[option.key] ?? option.defaultValue;
      final normalized = choices.any((c) => c.value == current) ? current : choices.first.value;

      return DropdownButtonFormField<String>(
        initialValue: normalized,
        isExpanded: true,
        decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8)),
        items: [
          for (final choice in choices)
            DropdownMenuItem(
              value: choice.value,
              child: Text(choice.label, style: Theme.of(context).textTheme.bodySmall, overflow: TextOverflow.ellipsis),
            ),
        ],
        onChanged: enabled ? (v) => _updateOptionValue(option, v ?? option.defaultValue) : null,
      );
    }

    return TextField(
      controller: _policyControllers[controllerKey],
      enabled: enabled,
      style: AppTheme.monospace.copyWith(fontSize: 12),
      decoration: InputDecoration(
        isDense: true,
        hintText: option.hint ?? option.defaultValue,
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      ),
      onChanged: (value) => _updateOptionValue(option, value),
    );
  }
}
