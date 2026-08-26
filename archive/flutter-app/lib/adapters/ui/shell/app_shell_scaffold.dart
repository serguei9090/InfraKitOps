import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_sidebar.dart';
import 'shell_state.dart';
import 'theme_provider.dart';

/// The persistent chrome around every route: brand mark + global search +
/// theme toggle in the app bar, the expandable tool tree in a sidebar that
/// never unmounts, and `child` (whatever go_router's ShellRoute resolved)
/// filling the remaining content area. New tools/modules never touch this
/// file — it only changes for genuinely global additions (a new top-level
/// nav affordance, a new piece of shell-wide state).
///
/// Below [_compactBreakpoint] (matching the threshold every tool screen
/// already uses via its own LayoutBuilder), the inline search box and the
/// sidebar's inline tool-list pane are replaced by modal equivalents so the
/// chrome itself never overflows on a narrow window.
class AppShellScaffold extends ConsumerWidget {
  const AppShellScaffold({super.key, required this.child});

  final Widget child;

  static const double _compactBreakpoint = 720;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    final scheme = Theme.of(context).colorScheme;

    return LayoutBuilder(
      builder: (context, constraints) {
        final isCompact = constraints.maxWidth < _compactBreakpoint;

        return Scaffold(
          appBar: AppBar(
            title: Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [scheme.primary, scheme.tertiary],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Icon(Icons.hub_outlined, color: scheme.onPrimary, size: 18),
                ),
                const SizedBox(width: 10),
                const Flexible(child: Text('InfraKit Studio', overflow: TextOverflow.ellipsis)),
              ],
            ),
            actions: [
              if (isCompact)
                IconButton(
                  tooltip: 'Search',
                  icon: const Icon(Icons.search),
                  onPressed: () => _showSearchDialog(context, ref),
                )
              else
                SizedBox(
                  width: 380,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: TextField(
                      onChanged: (value) => ref.read(searchQueryProvider.notifier).state = value,
                      textAlignVertical: TextAlignVertical.center,
                      decoration: InputDecoration(
                        isDense: true,
                        prefixIcon: const Icon(Icons.search, size: 20),
                        prefixIconConstraints: const BoxConstraints(minWidth: 36, minHeight: 20),
                        hintText: 'Search tools, formulas, cheatsheets...',
                        suffixIcon: Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: Center(
                            widthFactor: 1,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: scheme.surfaceContainerHighest,
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text('Ctrl+K', style: Theme.of(context).textTheme.labelSmall),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              const SizedBox(width: 12),
              IconButton(
                tooltip: 'Toggle theme',
                icon: Icon(themeMode == ThemeMode.dark ? Icons.dark_mode_outlined : Icons.light_mode_outlined),
                onPressed: () {
                  ref.read(themeModeProvider.notifier).state =
                      themeMode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark;
                },
              ),
              const SizedBox(width: 8),
            ],
          ),
          body: Row(
            children: [
              AppSidebar(isCompact: isCompact),
              VerticalDivider(width: 1, color: scheme.outlineVariant.withValues(alpha: 0.6)),
              Expanded(child: child),
            ],
          ),
        );
      },
    );
  }

  void _showSearchDialog(BuildContext context, WidgetRef ref) {
    final controller = TextEditingController(text: ref.read(searchQueryProvider));
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Search'),
        content: TextField(
          controller: controller,
          autofocus: true,
          onChanged: (value) => ref.read(searchQueryProvider.notifier).state = value,
          textAlignVertical: TextAlignVertical.center,
          decoration: const InputDecoration(
            isDense: true,
            prefixIcon: Icon(Icons.search, size: 20),
            prefixIconConstraints: BoxConstraints(minWidth: 36, minHeight: 20),
            hintText: 'Search tools, formulas, cheatsheets...',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Done')),
        ],
      ),
    );
  }
}
