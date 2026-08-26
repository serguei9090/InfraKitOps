import 'package:flutter/material.dart';

import '../../../core/config/crontab_builder.dart';
import '../shell/app_theme.dart';
import '../shell/tool_detail_scaffold.dart';

/// Which side of the tool is active: build a new expression from structured
/// fields, or paste and explain an existing one.
enum _Mode { build, explain }

/// The four field-generation kinds this screen exposes per column. A fifth
/// kind ([CronFieldSpecKind.rangeStep]) exists on the core model but is not
/// offered here — every/list/range/step covers the picker UI this screen is
/// scoped to.
enum _Kind { every, list, range, step }

/// Static metadata for one of the five crontab columns: display label and
/// legal numeric range, used only to label inputs and phrase inline errors.
/// This mirrors (but does not import — it's private to the core file) the
/// `_FieldMeta` table in `crontab_builder.dart`.
class _ColumnMeta {
  const _ColumnMeta({required this.label, required this.field, required this.min, required this.max});

  final String label;
  final CronField field;
  final int min;
  final int max;
}

const _columns = <_ColumnMeta>[
  _ColumnMeta(label: 'Minute', field: CronField.minute, min: 0, max: 59),
  _ColumnMeta(label: 'Hour', field: CronField.hour, min: 0, max: 23),
  _ColumnMeta(label: 'Day of month', field: CronField.dayOfMonth, min: 1, max: 31),
  _ColumnMeta(label: 'Month', field: CronField.month, min: 1, max: 12),
  _ColumnMeta(label: 'Day of week', field: CronField.dayOfWeek, min: 0, max: 7),
];

const _weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _monthNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/// Per-column controllers backing the "Build" picker: which [_Kind] is
/// active, plus one text controller for each kind's inputs. Only the
/// controller(s) matching the active kind are read when generating the spec.
class _FieldControllers {
  _Kind kind = _Kind.every;
  final list = TextEditingController();
  final rangeStart = TextEditingController();
  final rangeEnd = TextEditingController();
  final step = TextEditingController();

  void dispose() {
    list.dispose();
    rangeStart.dispose();
    rangeEnd.dispose();
    step.dispose();
  }
}

/// "Crontab Expression Builder" tool screen: build a five-field crontab
/// expression from structured per-column pickers, or paste and explain an
/// existing expression — either way the right panel shows the resulting
/// expression, its plain-English meaning, and the next 5 matching run times.
///
/// Built on the shared [ToolDetailScaffold] split-panel layout. Every parse
/// or range error (a bad pasted expression, an out-of-range field value, an
/// unparsable list/range/step) is caught and rendered inline; nothing here
/// ever lets [CrontabBuilder]'s exceptions reach the widget tree.
class CrontabBuilderScreen extends StatefulWidget {
  const CrontabBuilderScreen({super.key});

  @override
  State<CrontabBuilderScreen> createState() => _CrontabBuilderScreenState();
}

class _CrontabBuilderScreenState extends State<CrontabBuilderScreen> {
  static const _useCase = CrontabBuilder();

  _Mode _mode = _Mode.build;

  final Map<CronField, _FieldControllers> _fields = {for (final c in _columns) c.field: _FieldControllers()};

  final _explainController = TextEditingController(text: '0 9 * * 1-5');

  /// Column -> inline error message, populated by [_recomputeBuild].
  final Map<CronField, String> _fieldErrors = {};

  CrontabResult? _result;
  String? _globalError;

  @override
  void initState() {
    super.initState();
    for (final controllers in _fields.values) {
      for (final c in [controllers.list, controllers.rangeStart, controllers.rangeEnd, controllers.step]) {
        c.addListener(_recompute);
      }
    }
    _explainController.addListener(_recompute);
    _recompute();
  }

  @override
  void dispose() {
    for (final controllers in _fields.values) {
      controllers.dispose();
    }
    _explainController.dispose();
    super.dispose();
  }

  void _recompute() {
    if (_mode == _Mode.build) {
      _recomputeBuild();
    } else {
      _recomputeExplain();
    }
  }

  void _recomputeBuild() {
    setState(() {
      _fieldErrors.clear();
      final specs = <CronField, CronFieldSpec>{};

      for (final meta in _columns) {
        try {
          specs[meta.field] = _specFrom(_fields[meta.field]!, meta);
        } catch (e) {
          _fieldErrors[meta.field] = _messageOf(e);
        }
      }

      if (_fieldErrors.isNotEmpty) {
        _result = null;
        _globalError = null;
        return;
      }

      try {
        _result = _useCase.execute(
          CrontabBuildInput(
            minute: specs[CronField.minute]!,
            hour: specs[CronField.hour]!,
            dayOfMonth: specs[CronField.dayOfMonth]!,
            month: specs[CronField.month]!,
            dayOfWeek: specs[CronField.dayOfWeek]!,
            from: DateTime.now(),
          ),
        );
        _globalError = null;
      } catch (e) {
        _result = null;
        _globalError = _messageOf(e);
      }
    });
  }

  void _recomputeExplain() {
    setState(() {
      _fieldErrors.clear();
      final text = _explainController.text.trim();
      if (text.isEmpty) {
        _result = null;
        _globalError = null;
        return;
      }
      try {
        _result = _useCase.describe(text, from: DateTime.now());
        _globalError = null;
      } catch (e) {
        _result = null;
        _globalError = _messageOf(e);
      }
    });
  }

  CronFieldSpec _specFrom(_FieldControllers controllers, _ColumnMeta meta) {
    switch (controllers.kind) {
      case _Kind.every:
        return const CronFieldSpec.every();

      case _Kind.list:
        final text = controllers.list.text.trim();
        if (text.isEmpty) {
          throw FormatException('Enter at least one value for ${meta.label} (e.g. 0,15,30)');
        }
        final values = <int>[];
        for (final piece in text.split(',')) {
          final token = piece.trim();
          final value = int.tryParse(token);
          if (value == null) {
            throw FormatException('"$token" is not a number in the ${meta.label} list');
          }
          values.add(value);
        }
        return CronFieldSpec.values(values);

      case _Kind.range:
        final startText = controllers.rangeStart.text.trim();
        final endText = controllers.rangeEnd.text.trim();
        final start = int.tryParse(startText);
        final end = int.tryParse(endText);
        if (start == null || end == null) {
          throw FormatException('Enter numeric start and end values for the ${meta.label} range');
        }
        return CronFieldSpec.range(start, end);

      case _Kind.step:
        final text = controllers.step.text.trim();
        final n = int.tryParse(text);
        if (n == null) {
          throw FormatException('Enter a numeric step for ${meta.label} (e.g. 15)');
        }
        return CronFieldSpec.step(n);
    }
  }

  String _messageOf(Object e) {
    if (e is ArgumentError) return e.message?.toString() ?? e.toString();
    if (e is FormatException) return e.message;
    return e.toString();
  }

  String _formatRun(DateTime dt) {
    final weekday = _weekdayNames[dt.weekday - 1];
    final month = _monthNames[dt.month - 1];
    final hh = dt.hour.toString().padLeft(2, '0');
    final mm = dt.minute.toString().padLeft(2, '0');
    return '$weekday, $month ${dt.day} ${dt.year}, $hh:$mm';
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'Crontab Expression Builder',
      copyText: _result?.expression,
      inputPanel: _buildInput(context),
      outputPanel: _buildOutput(context),
    );
  }

  Widget _buildInput(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SegmentedButton<_Mode>(
          segments: const [
            ButtonSegment(value: _Mode.build, label: Text('Build'), icon: Icon(Icons.tune)),
            ButtonSegment(value: _Mode.explain, label: Text('Explain'), icon: Icon(Icons.help_outline)),
          ],
          selected: {_mode},
          onSelectionChanged: (selection) {
            setState(() => _mode = selection.first);
            _recompute();
          },
        ),
        const SizedBox(height: 20),
        if (_mode == _Mode.build) _buildFieldPickers(context) else _buildExplainInput(context),
        if (_globalError != null) ...[
          const SizedBox(height: 16),
          Text(_globalError!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ],
      ],
    );
  }

  Widget _buildFieldPickers(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final meta in _columns) ...[
          _FieldPicker(
            meta: meta,
            controllers: _fields[meta.field]!,
            error: _fieldErrors[meta.field],
            onKindChanged: (kind) {
              setState(() => _fields[meta.field]!.kind = kind);
              _recompute();
            },
          ),
          const SizedBox(height: 18),
        ],
      ],
    );
  }

  Widget _buildExplainInput(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Crontab expression', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _explainController,
          style: const TextStyle(fontFamily: 'monospace'),
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: 'e.g. 0 9 * * 1-5 or @daily',
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Five whitespace-separated fields (minute hour day-of-month month '
          'day-of-week), or a shortcut like @daily, @hourly, @reboot.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }

  Widget _buildOutput(BuildContext context) {
    final result = _result;
    if (result == null) {
      return Text(
        _mode == _Mode.build
            ? 'Fix the highlighted fields to generate an expression.'
            : 'Paste a crontab expression to explain it.',
        style: Theme.of(context).textTheme.bodyMedium,
      );
    }

    final scheme = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Expression', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: SelectableText(result.expression, style: AppTheme.monospace.copyWith(color: scheme.onSurface)),
          ),
        ),
        const SizedBox(height: 16),
        Text('Meaning', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        SelectableText(result.description, style: Theme.of(context).textTheme.bodyMedium),
        const SizedBox(height: 20),
        Text('Next 5 run times', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        if (result.isReboot)
          Text(
            'Runs once at system startup — there is no wall-clock schedule to list.',
            style: Theme.of(context).textTheme.bodyMedium,
          )
        else if (result.nextRuns.isEmpty)
          Text(
            'This schedule never matches a real calendar date (e.g. Feb 30).',
            style: Theme.of(context).textTheme.bodyMedium,
          )
        else
          Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final run in result.nextRuns)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      child: Text(_formatRun(run), style: const TextStyle(fontFamily: 'monospace')),
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// One column's picker: a kind dropdown (every/list/range/step) plus the
/// input(s) relevant to whichever kind is selected, with an inline error
/// message when the current text doesn't parse.
class _FieldPicker extends StatelessWidget {
  const _FieldPicker({required this.meta, required this.controllers, required this.error, required this.onKindChanged});

  final _ColumnMeta meta;
  final _FieldControllers controllers;
  final String? error;
  final ValueChanged<_Kind> onKindChanged;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${meta.label} (${meta.min}-${meta.max})',
                    style: Theme.of(context).textTheme.labelLarge,
                  ),
                ),
                DropdownButton<_Kind>(
                  value: controllers.kind,
                  underline: const SizedBox.shrink(),
                  items: const [
                    DropdownMenuItem(value: _Kind.every, child: Text('every')),
                    DropdownMenuItem(value: _Kind.list, child: Text('list')),
                    DropdownMenuItem(value: _Kind.range, child: Text('range')),
                    DropdownMenuItem(value: _Kind.step, child: Text('step')),
                  ],
                  onChanged: (kind) {
                    if (kind != null) onKindChanged(kind);
                  },
                ),
              ],
            ),
            const SizedBox(height: 10),
            _buildInputs(context),
            if (error != null) ...[
              const SizedBox(height: 6),
              Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12)),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildInputs(BuildContext context) {
    switch (controllers.kind) {
      case _Kind.every:
        return Text(
          'Matches every ${meta.label.toLowerCase()} value.',
          style: Theme.of(context).textTheme.bodySmall,
        );

      case _Kind.list:
        return TextField(
          controller: controllers.list,
          style: const TextStyle(fontFamily: 'monospace'),
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'e.g. 0,15,30', isDense: true),
        );

      case _Kind.range:
        return Row(
          children: [
            Expanded(
              child: TextField(
                controller: controllers.rangeStart,
                style: const TextStyle(fontFamily: 'monospace'),
                decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'from', isDense: true),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: TextField(
                controller: controllers.rangeEnd,
                style: const TextStyle(fontFamily: 'monospace'),
                decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'to', isDense: true),
              ),
            ),
          ],
        );

      case _Kind.step:
        return TextField(
          controller: controllers.step,
          style: const TextStyle(fontFamily: 'monospace'),
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'e.g. 15', isDense: true),
        );
    }
  }
}
