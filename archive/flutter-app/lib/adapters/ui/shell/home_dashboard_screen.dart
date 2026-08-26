import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'module_section_view.dart';
import 'module_visibility_provider.dart';

/// Page 1 — "All Tools": every visible module's name + its tools, for
/// browsing and picking one to drill into. Rendered inside
/// AppShellScaffold's content area (the sidebar/app bar are the shell's
/// job, not this screen's). Purely derived from kModuleTaxonomy +
/// modulePrefsProvider, so a new module/tool or a reorder/hide choice needs
/// zero changes here.
class HomeDashboardScreen extends ConsumerWidget {
  const HomeDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final modules = visibleModulesInOrder(ref.watch(modulePrefsProvider));

    return SingleChildScrollView(
      padding: const EdgeInsets.all(28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final module in modules) ModuleSectionView(module: module),
        ],
      ),
    );
  }
}
