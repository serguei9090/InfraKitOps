import 'dart:convert';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import '../../../core/tuning/sysctl_config_builder.dart';
import '../shell/app_theme.dart';
import '../shell/file_drop_field.dart';
import '../shell/tool_detail_scaffold.dart';

/// Kernel Parameter Config Builder: pick any subset of the sysctl catalog,
/// set each value, and emit either a temporary `sysctl -w` script or a
/// permanent `/etc/sysctl.d/*.conf` snippet.
///
/// The catalog is large (100+ parameters across seven categories), so this
/// screen leans on three things to stay usable: a search box that filters
/// across key/label/description, collapsible categories, and presets that
/// select a coherent group of parameters in one click. Widgets are chosen
/// from each parameter's [SysctlValueKind] — enumerated values get a
/// dropdown and booleans a switch, so a user can't type an illegal value
/// for a parameter that only accepts a fixed set.
class SysctlConfigBuilderScreen extends StatefulWidget {
  const SysctlConfigBuilderScreen({super.key});

  @override
  State<SysctlConfigBuilderScreen> createState() => _SysctlConfigBuilderScreenState();
}

class _SysctlConfigBuilderScreenState extends State<SysctlConfigBuilderScreen> {
  static const _builder = SysctlConfigBuilder();

  OutputMode _mode = OutputMode.permanent;

  /// Parameter key -> chosen value. Presence in this map *is* selection.
  final Map<String, String> _selectedValues = {};

  /// Controllers only for the free-text-ish kinds; enumerated/boolean
  /// parameters store their value straight into [_selectedValues].
  late final Map<String, TextEditingController> _controllers = {
    for (final parameter in kSysctlParameterCatalog)
      parameter.key: TextEditingController(text: parameter.defaultValue),
  };

  final _searchController = TextEditingController();
  String _query = '';
  String? _saveStatus;
  bool _saveWasError = false;

  String get _output => _builder.execute(SysctlConfigBuilderInput(selectedValues: _selectedValues, mode: _mode));

  @override
  void initState() {
    super.initState();
    _searchController.addListener(() => setState(() => _query = _searchController.text));
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    _searchController.dispose();
    super.dispose();
  }

  void _toggleParameter(SysctlParameter parameter, bool checked) {
    setState(() {
      if (checked) {
        _selectedValues[parameter.key] = _controllers[parameter.key]!.text;
      } else {
        _selectedValues.remove(parameter.key);
      }
    });
  }

  void _updateValue(SysctlParameter parameter, String value) {
    setState(() {
      _selectedValues[parameter.key] = value;
      _controllers[parameter.key]?.text = value;
    });
  }

  void _applyPreset(SysctlPreset preset) {
    setState(() {
      preset.resolve().forEach((key, value) {
        _selectedValues[key] = value;
        _controllers[key]?.text = value;
      });
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Applied "${preset.name}" (${preset.values.length} parameters)')),
    );
  }

  void _clearSelection() {
    setState(() {
      _selectedValues.clear();
      for (final parameter in kSysctlParameterCatalog) {
        _controllers[parameter.key]?.text = parameter.defaultValue;
      }
    });
  }

  Future<void> _save() async {
    setState(() => _saveStatus = null);
    try {
      final name = _mode == OutputMode.permanent ? '99-infrakit-custom.conf' : 'apply-sysctl.sh';
      final savedTo = await saveBytesWithDialog(
        bytes: utf8.encode(_output),
        suggestedName: name,
        mimeType: 'text/plain',
        acceptedTypes: [
          XTypeGroup(label: 'Config', extensions: [_mode == OutputMode.permanent ? 'conf' : 'sh']),
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

  bool _matchesQuery(SysctlParameter parameter) {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return true;
    return parameter.key.toLowerCase().contains(q) ||
        parameter.label.toLowerCase().contains(q) ||
        parameter.description.toLowerCase().contains(q);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final searching = _query.trim().isNotEmpty;
    final totalMatches = kSysctlParameterCatalog.where(_matchesQuery).length;

    return ToolDetailScaffold(
      title: 'Kernel Parameter Config Builder',
      copyText: _output,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Change type', style: textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            'Temporary applies now via sysctl -w and is lost on reboot. '
            'Permanent writes a sysctl.d snippet applied with sysctl -p / --system.',
            style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 8),
          SegmentedButton<OutputMode>(
            segments: const [
              ButtonSegment(value: OutputMode.temporary, label: Text('Temporary'), icon: Icon(Icons.bolt_outlined)),
              ButtonSegment(value: OutputMode.permanent, label: Text('Permanent'), icon: Icon(Icons.save_outlined)),
            ],
            selected: {_mode},
            onSelectionChanged: (selection) => setState(() => _mode = selection.first),
          ),
          const SizedBox(height: 20),
          _buildPresets(context),
          const SizedBox(height: 20),
          TextField(
            controller: _searchController,
            decoration: InputDecoration(
              hintText: 'Search ${kSysctlParameterCatalog.length} parameters by key or description…',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: searching
                  ? IconButton(icon: const Icon(Icons.clear), onPressed: _searchController.clear)
                  : null,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  searching
                      ? '$totalMatches match${totalMatches == 1 ? '' : 'es'} · ${_selectedValues.length} selected'
                      : '${_selectedValues.length} parameter${_selectedValues.length == 1 ? '' : 's'} selected — only these appear in the output',
                  style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                ),
              ),
              if (_selectedValues.isNotEmpty)
                TextButton.icon(
                  onPressed: _clearSelection,
                  icon: const Icon(Icons.clear_all, size: 16),
                  label: const Text('Clear'),
                ),
            ],
          ),
          const SizedBox(height: 8),
          for (final category in SysctlParameterCategory.values)
            _buildCategory(context, category, searching: searching),
          if (searching && totalMatches == 0)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Text('No parameters match "$_query".', style: textTheme.bodyMedium),
            ),
        ],
      ),
      outputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text('Generated configuration', style: textTheme.titleMedium)),
              OutlinedButton.icon(
                onPressed: _selectedValues.isEmpty ? null : _save,
                icon: const Icon(Icons.download, size: 16),
                label: const Text('Save as file'),
              ),
            ],
          ),
          if (_saveStatus != null) ...[
            const SizedBox(height: 8),
            Text(
              _saveStatus!,
              style: textTheme.bodySmall?.copyWith(color: _saveWasError ? scheme.error : scheme.primary),
            ),
          ],
          const SizedBox(height: 8),
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
              child: SelectableText(_output, style: AppTheme.monospace),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPresets(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Presets', style: textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(kSysctlPresetCaveat, style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final preset in kSysctlPresets)
              Tooltip(
                message: preset.description,
                child: OutlinedButton.icon(
                  onPressed: () => _applyPreset(preset),
                  icon: const Icon(Icons.playlist_add, size: 16),
                  label: Text(preset.name),
                ),
              ),
          ],
        ),
      ],
    );
  }

  Widget _buildCategory(BuildContext context, SysctlParameterCategory category, {required bool searching}) {
    final scheme = Theme.of(context).colorScheme;
    final parameters = kSysctlParameterCatalog.where((p) => p.category == category).where(_matchesQuery).toList();
    if (parameters.isEmpty) return const SizedBox.shrink();

    final selectedCount = parameters.where((p) => _selectedValues.containsKey(p.key)).length;

    return Theme(
      // ExpansionTile paints a divider above/below by default; drop it so
      // stacked categories in this narrow left pane read as one clean list.
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        // A search should surface its hits, so matching categories open
        // themselves; the key forces a rebuild when the query changes so
        // ExpansionTile re-reads initiallyExpanded.
        key: PageStorageKey('${category.name}_$searching'),
        initiallyExpanded: searching || category == SysctlParameterCategory.memoryManagement,
        tilePadding: EdgeInsets.zero,
        childrenPadding: const EdgeInsets.only(left: 4, bottom: 8),
        title: Row(
          children: [
            Expanded(
              child: Text(
                category.label,
                style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
            Text(
              '${parameters.length}',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
            if (selectedCount > 0) ...[
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: AppTheme.selectedIndicatorColor(scheme),
                  borderRadius: BorderRadius.circular(AppTheme.selectedIndicatorRadius),
                ),
                child: Text(
                  '$selectedCount',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.onPrimaryContainer),
                ),
              ),
            ],
          ],
        ),
        children: [for (final parameter in parameters) _buildParameterRow(context, parameter)],
      ),
    );
  }

  Widget _buildParameterRow(BuildContext context, SysctlParameter parameter) {
    final scheme = Theme.of(context).colorScheme;
    final checked = _selectedValues.containsKey(parameter.key);

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Checkbox(value: checked, onChanged: (value) => _toggleParameter(parameter, value ?? false)),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: SelectableText(
                              parameter.key,
                              style: AppTheme.monospace.copyWith(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: checked ? scheme.primary : scheme.onSurface,
                              ),
                            ),
                          ),
                          if (parameter.riskNote != null) ...[
                            const SizedBox(width: 6),
                            Tooltip(
                              message: parameter.riskNote!,
                              child: Icon(Icons.warning_amber_rounded, size: 16, color: scheme.error),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        parameter.description,
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
            child: _buildValueEditor(context, parameter, checked),
          ),
        ],
      ),
    );
  }

  /// Picks the input widget from the parameter's value kind, so a parameter
  /// with a fixed legal set can never be given a free-text value.
  Widget _buildValueEditor(BuildContext context, SysctlParameter parameter, bool enabled) {
    // The core already resolves "which choices does a picker offer" per
    // value kind (enumerated -> its options, boolean -> the 0/1 pair,
    // free-entry kinds -> empty), so defer to it rather than re-deriving.
    final options = parameter.effectiveOptions;

    if (options.isNotEmpty) {
      final current = _selectedValues[parameter.key] ?? parameter.defaultValue;
      final value = options.any((o) => o.value == current) ? current : options.first.value;

      return DropdownButtonFormField<String>(
        initialValue: value,
        isExpanded: true,
        decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8)),
        items: [
          for (final option in options)
            DropdownMenuItem(
              value: option.value,
              child: Text(option.label, style: Theme.of(context).textTheme.bodySmall, overflow: TextOverflow.ellipsis),
            ),
        ],
        onChanged: enabled ? (v) => _updateValue(parameter, v ?? parameter.defaultValue) : null,
      );
    }

    return TextField(
      controller: _controllers[parameter.key],
      enabled: enabled,
      keyboardType: parameter.kind == SysctlValueKind.integer ? TextInputType.number : TextInputType.text,
      style: AppTheme.monospace.copyWith(fontSize: 12),
      decoration: InputDecoration(
        isDense: true,
        hintText: parameter.defaultValue,
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      ),
      onChanged: (value) => _updateValue(parameter, value),
    );
  }
}
