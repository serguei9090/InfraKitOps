import 'package:flutter/material.dart';

import '../../../core/config/chmod_calculator.dart';
import '../shell/app_theme.dart';
import '../shell/tool_detail_scaffold.dart';

/// "chmod Calculator" tool screen: converts between the octal, symbolic and
/// structured (checkbox grid) representations of a Unix file mode, and
/// explains what the resulting mode allows.
///
/// Built on the shared [ToolDetailScaffold] split-panel layout. The left
/// panel holds a 3x3 read/write/execute checkbox grid (owner/group/other),
/// the three special-bit switches (setuid/setgid/sticky), and separate
/// editable octal and symbolic text fields. All three representations read
/// from and write back to a single [ChmodPermissions] source of truth, so
/// editing any one updates the other two — the same two-way-sync pattern
/// [ColorToolsScreen] uses for hex/RGB/HSL.
class ChmodCalculatorScreen extends StatefulWidget {
  const ChmodCalculatorScreen({super.key});

  @override
  State<ChmodCalculatorScreen> createState() => _ChmodCalculatorScreenState();
}

class _ChmodCalculatorScreenState extends State<ChmodCalculatorScreen> {
  static const _useCase = ChmodCalculator();

  late final TextEditingController _octalController;
  late final TextEditingController _symbolicController;
  late final TextEditingController _pathController;

  /// Single source of truth every representation reads from and writes back
  /// to. Defaults to 755, a sensible starting point for a script/executable.
  ChmodPermissions _permissions = const ChmodPermissions(
    owner: PermissionTriad(read: true, write: true, execute: true),
    group: PermissionTriad(read: true, execute: true),
    other: PermissionTriad(read: true, execute: true),
  );

  /// Guards against a programmatic controller.text update re-triggering its
  /// own listener and re-parsing (possibly reformatted) text.
  bool _syncing = false;

  String? _octalError;
  String? _symbolicError;

  @override
  void initState() {
    super.initState();
    _octalController = TextEditingController()..addListener(_onOctalChanged);
    _symbolicController = TextEditingController()..addListener(_onSymbolicChanged);
    _pathController = TextEditingController(text: 'filename')..addListener(() => setState(() {}));

    _syncControllersFrom(_permissions);
  }

  @override
  void dispose() {
    _octalController.dispose();
    _symbolicController.dispose();
    _pathController.dispose();
    super.dispose();
  }

  void _onOctalChanged() {
    if (_syncing) return;
    final text = _octalController.text.trim();
    if (text.isEmpty) {
      setState(() => _octalError = null);
      return;
    }
    try {
      final permissions = _useCase.parseOctal(text);
      _applyPermissions(permissions, skip: {_octalController});
      setState(() => _octalError = null);
    } on FormatException catch (e) {
      setState(() => _octalError = e.message);
    } catch (e) {
      setState(() => _octalError = e.toString());
    }
  }

  void _onSymbolicChanged() {
    if (_syncing) return;
    final text = _symbolicController.text.trim();
    if (text.isEmpty) {
      setState(() => _symbolicError = null);
      return;
    }
    try {
      final permissions = _useCase.parseSymbolic(text);
      _applyPermissions(permissions, skip: {_symbolicController});
      setState(() => _symbolicError = null);
    } on FormatException catch (e) {
      setState(() => _symbolicError = e.message);
    } catch (e) {
      setState(() => _symbolicError = e.toString());
    }
  }

  /// Applies a permissions change that came from the checkbox grid or a
  /// special-bit switch: both text fields must follow, so nothing is
  /// skipped.
  void _applyFromControls(ChmodPermissions permissions) {
    _applyPermissions(permissions, skip: const {});
    setState(() {
      _octalError = null;
      _symbolicError = null;
    });
  }

  void _applyPermissions(ChmodPermissions permissions, {required Set<TextEditingController> skip}) {
    setState(() => _permissions = permissions);
    _syncControllersFrom(permissions, skip: skip);
  }

  void _syncControllersFrom(ChmodPermissions permissions, {Set<TextEditingController> skip = const {}}) {
    _syncing = true;

    void setText(TextEditingController c, String text) {
      if (skip.contains(c)) return;
      if (c.text != text) c.text = text;
    }

    setText(_octalController, permissions.octalPreferred);
    setText(_symbolicController, permissions.symbolic);

    _syncing = false;
  }

  void _setTriad(String who, PermissionTriad Function(PermissionTriad) update) {
    switch (who) {
      case 'owner':
        _applyFromControls(_permissions.copyWith(owner: update(_permissions.owner)));
      case 'group':
        _applyFromControls(_permissions.copyWith(group: update(_permissions.group)));
      case 'other':
        _applyFromControls(_permissions.copyWith(other: update(_permissions.other)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final path = _pathController.text.trim().isEmpty ? 'filename' : _pathController.text.trim();
    final result = _useCase.fromPermissions(_permissions, path: path);

    return ToolDetailScaffold(
      title: 'chmod Calculator',
      copyText: result.command,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Permissions', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          _PermissionGrid(permissions: _permissions, onChanged: _setTriad),
          const SizedBox(height: 20),
          Text('Special bits', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          _specialSwitch(
            label: 'setuid (4000)',
            value: _permissions.setUid,
            onChanged: (v) => _applyFromControls(_permissions.copyWith(setUid: v)),
          ),
          _specialSwitch(
            label: 'setgid (2000)',
            value: _permissions.setGid,
            onChanged: (v) => _applyFromControls(_permissions.copyWith(setGid: v)),
          ),
          _specialSwitch(
            label: 'sticky (1000)',
            value: _permissions.sticky,
            onChanged: (v) => _applyFromControls(_permissions.copyWith(sticky: v)),
          ),
          const SizedBox(height: 20),
          Text('Target path', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 8),
          TextField(
            controller: _pathController,
            style: const TextStyle(fontFamily: 'monospace'),
            decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'filename'),
          ),
          const SizedBox(height: 20),
          Text('Octal', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 8),
          TextField(
            controller: _octalController,
            style: const TextStyle(fontFamily: 'monospace'),
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              hintText: 'e.g. 755 or 4755',
              errorText: _octalError,
            ),
          ),
          const SizedBox(height: 20),
          Text('Symbolic', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 8),
          TextField(
            controller: _symbolicController,
            style: const TextStyle(fontFamily: 'monospace'),
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              hintText: 'e.g. rwxr-xr-x',
              errorText: _symbolicError,
            ),
          ),
        ],
      ),
      outputPanel: _buildOutput(context, result),
    );
  }

  Widget _specialSwitch({required String label, required bool value, required ValueChanged<bool> onChanged}) {
    return SwitchListTile(
      title: Text(label),
      value: value,
      onChanged: onChanged,
      contentPadding: EdgeInsets.zero,
      dense: true,
    );
  }

  Widget _buildOutput(BuildContext context, ChmodResult result) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Command', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: SelectableText(result.command, style: AppTheme.monospace.copyWith(color: scheme.onSurface)),
          ),
        ),
        const SizedBox(height: 16),
        _FieldRow(label: 'Octal', value: result.octalFull),
        _FieldRow(label: 'Symbolic', value: result.symbolic),
        const SizedBox(height: 20),
        Text('What this allows', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        SelectableText(result.description, style: Theme.of(context).textTheme.bodyMedium),
      ],
    );
  }
}

/// The 3x3 owner/group/other x read/write/execute checkbox grid.
class _PermissionGrid extends StatelessWidget {
  const _PermissionGrid({required this.permissions, required this.onChanged});

  final ChmodPermissions permissions;

  /// Called with the class ('owner'/'group'/'other') and a function that
  /// derives the updated triad from the current one.
  final void Function(String who, PermissionTriad Function(PermissionTriad) update) onChanged;

  @override
  Widget build(BuildContext context) {
    final labelStyle = Theme.of(context).textTheme.labelLarge;

    Widget headerCell(String text) => Expanded(
      child: Center(child: Text(text, style: labelStyle)),
    );

    Widget checkboxCell({required bool value, required ValueChanged<bool?> onChanged}) => Expanded(
      child: Center(child: Checkbox(value: value, onChanged: onChanged)),
    );

    Widget row(String who, String label, PermissionTriad triad) {
      return Row(
        children: [
          SizedBox(width: 70, child: Text(label, style: labelStyle)),
          checkboxCell(
            value: triad.read,
            onChanged: (v) => onChanged(who, (t) => t.copyWith(read: v ?? false)),
          ),
          checkboxCell(
            value: triad.write,
            onChanged: (v) => onChanged(who, (t) => t.copyWith(write: v ?? false)),
          ),
          checkboxCell(
            value: triad.execute,
            onChanged: (v) => onChanged(who, (t) => t.copyWith(execute: v ?? false)),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const SizedBox(width: 70),
            headerCell('Read'),
            headerCell('Write'),
            headerCell('Exec'),
          ],
        ),
        row('owner', 'Owner', permissions.owner),
        row('group', 'Group', permissions.group),
        row('other', 'Other', permissions.other),
      ],
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
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 90,
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
