import 'package:flutter/material.dart';

import 'module_section_view.dart';
import 'module_taxonomy.dart';

/// Page 2 — a single selected module's tools, sidebar still visible around
/// it (this is only the content pane). Matches the DevToys-style reference:
/// pick a category in the sidebar, the main pane narrows to just that
/// category's tools.
class ModuleToolsScreen extends StatelessWidget {
  const ModuleToolsScreen({super.key, required this.moduleId});

  final String moduleId;

  @override
  Widget build(BuildContext context) {
    ModuleSection? module;
    for (final candidate in kModuleTaxonomy) {
      if (candidate.id == moduleId) {
        module = candidate;
        break;
      }
    }

    if (module == null) {
      return Center(child: Text('Unknown module "$moduleId"', style: Theme.of(context).textTheme.bodyLarge));
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(28),
      child: ModuleSectionView(module: module, linkHeaderToModulePage: false),
    );
  }
}
