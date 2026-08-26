import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'app_theme.dart';
import 'module_settings_dialog.dart';
import 'module_taxonomy.dart';
import 'module_visibility_provider.dart';
import 'shell_state.dart';

/// Persistent icon rail (module switcher, never hides) + an adjacent swap
/// pane that lists the active module's tools. Clicking a different rail
/// icon swaps the pane's contents in place — no back button, current
/// module always visible via the highlighted icon. Adding a new
/// tool/module never touches this file — it renders off kModuleTaxonomy
/// and modulePrefsProvider.
///
/// When [isCompact] (window too narrow for the inline 240px tool-list pane
/// — see [AppShellScaffold]'s breakpoint), the pane is dropped from the
/// row and surfaced instead via a "view tools" button that opens it as a
/// bottom sheet, so the rail never competes with the content area for
/// space on a narrow window.
class AppSidebar extends ConsumerWidget {
  const AppSidebar({super.key, required this.isCompact});

  final bool isCompact;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prefs = ref.watch(modulePrefsProvider);
    final modules = visibleModulesInOrder(prefs);
    final currentLocation = GoRouterState.of(context).uri.toString();
    final activeModuleId = _activeModuleId(currentLocation);
    final scheme = Theme.of(context).colorScheme;
    final activeModule = activeModuleId == null ? null : modules.firstWhere((m) => m.id == activeModuleId);

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _ModuleRail(
          modules: modules,
          activeModuleId: activeModuleId,
          currentLocation: currentLocation,
          isCompact: isCompact,
          onShowToolList: activeModule == null
              ? null
              : () => _showToolListSheet(context, module: activeModule, currentLocation: currentLocation),
        ),
        if (!isCompact) ...[
          VerticalDivider(width: 1, color: scheme.outlineVariant.withValues(alpha: 0.6)),
          AnimatedSize(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
            child: activeModuleId == null
                ? const SizedBox(width: 0)
                : SizedBox(
                    width: 240,
                    child: _ToolListPane(module: activeModule!, currentLocation: currentLocation),
                  ),
          ),
        ],
      ],
    );
  }

  void _showToolListSheet(BuildContext context, {required ModuleSection module, required String currentLocation}) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      constraints: const BoxConstraints(maxHeight: 480),
      builder: (_) => SizedBox(
        height: 440,
        child: _ToolListPane(module: module, currentLocation: currentLocation),
      ),
    );
  }

  String? _activeModuleId(String location) {
    if (location == '/') return null;
    if (location.startsWith('/modules/')) return location.substring('/modules/'.length);
    return moduleContainingRoute(location)?.id;
  }
}

class _ModuleRail extends ConsumerWidget {
  const _ModuleRail({
    required this.modules,
    required this.activeModuleId,
    required this.currentLocation,
    required this.isCompact,
    required this.onShowToolList,
  });

  final List<ModuleSection> modules;
  final String? activeModuleId;
  final String currentLocation;
  final bool isCompact;
  final VoidCallback? onShowToolList;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SizedBox(
      width: 64,
      child: Column(
        children: [
          const SizedBox(height: 8),
          _RailIcon(
            icon: Icons.grid_view_rounded,
            tooltip: 'All Tools',
            selected: currentLocation == '/',
            onTap: () => context.go('/'),
          ),
          const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Divider(height: 1)),
          Expanded(
            child: ListView(
              children: [
                for (final module in modules)
                  _RailIcon(
                    icon: module.icon,
                    tooltip: module.title,
                    selected: module.id == activeModuleId,
                    onTap: () => context.go('/modules/${module.id}'),
                  ),
              ],
            ),
          ),
          if (isCompact && onShowToolList != null)
            _RailIcon(icon: Icons.list_alt_outlined, tooltip: 'This module\'s tools', selected: false, onTap: onShowToolList!),
          IconButton(
            tooltip: 'Rearrange modules',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => showDialog(context: context, builder: (_) => const ModuleSettingsDialog()),
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

class _RailIcon extends StatelessWidget {
  const _RailIcon({required this.icon, required this.tooltip, required this.selected, required this.onTap});

  final IconData icon;
  final String tooltip;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      child: Tooltip(
        message: tooltip,
        child: InkWell(
          borderRadius: BorderRadius.circular(AppTheme.selectedIndicatorRadius),
          onTap: onTap,
          child: Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: selected ? AppTheme.selectedIndicatorColor(scheme) : Colors.transparent,
              borderRadius: BorderRadius.circular(AppTheme.selectedIndicatorRadius),
            ),
            child: Icon(icon, color: selected ? scheme.onPrimaryContainer : scheme.onSurfaceVariant, size: 22),
          ),
        ),
      ),
    );
  }
}

class _ToolListPane extends ConsumerWidget {
  const _ToolListPane({required this.module, required this.currentLocation});

  final ModuleSection module;
  final String currentLocation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final query = ref.watch(searchQueryProvider).trim().toLowerCase();
    final scheme = Theme.of(context).colorScheme;

    final tools = query.isEmpty
        ? module.tools
        : module.tools
              .where((t) => t.name.toLowerCase().contains(query) || t.description.toLowerCase().contains(query))
              .toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Text(
            module.title,
            style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
            overflow: TextOverflow.ellipsis,
          ),
        ),
        Expanded(
          child: ListView(
            children: [
              for (final tool in tools)
                ListTile(
                  dense: true,
                  leading: Icon(tool.icon, size: 18),
                  title: Text(tool.name, overflow: TextOverflow.ellipsis),
                  trailing: tool.route == null
                      ? Text(
                          'soon',
                          style: Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
                        )
                      : null,
                  selected: tool.route != null && currentLocation == tool.route,
                  enabled: tool.route != null,
                  onTap: tool.route == null ? null : () => context.go(tool.route!),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
