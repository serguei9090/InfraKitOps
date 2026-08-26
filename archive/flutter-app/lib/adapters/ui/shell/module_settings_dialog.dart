import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'module_taxonomy.dart';
import 'module_visibility_provider.dart';

/// The sidebar's gear-button dialog: drag to reorder modules, checkbox to
/// hide/show. Backed by modulePrefsProvider, so the rail and the "All
/// Tools" overview update live as you edit here.
class ModuleSettingsDialog extends ConsumerWidget {
  const ModuleSettingsDialog({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prefs = ref.watch(modulePrefsProvider);
    final byId = {for (final m in kModuleTaxonomy) m.id: m};

    return AlertDialog(
      title: const Text('Rearrange modules'),
      content: SizedBox(
        width: 380,
        height: 420,
        child: ReorderableListView(
          onReorderItem: (oldIndex, newIndex) => ref.read(modulePrefsProvider.notifier).reorder(oldIndex, newIndex),
          children: [
            for (final id in prefs.order)
              if (byId[id] case final module?)
                CheckboxListTile(
                  key: ValueKey(id),
                  secondary: Icon(module.icon),
                  title: Text(module.title),
                  value: !prefs.hiddenIds.contains(id),
                  onChanged: (_) => ref.read(modulePrefsProvider.notifier).toggleHidden(id),
                ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Done')),
      ],
    );
  }
}
