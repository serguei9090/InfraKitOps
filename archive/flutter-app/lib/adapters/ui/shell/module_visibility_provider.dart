import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'module_taxonomy.dart';

/// User's module ordering + hide/show choices for the sidebar rail and the
/// "All Tools" overview. In-memory only for now (resets on restart) —
/// wiring this to IStoragePort for persistence is a later-phase follow-up,
/// not blocking the UI feature itself.
class ModulePrefs {
  const ModulePrefs({required this.order, required this.hiddenIds});

  /// All module ids, in display order (hidden ones included, just filtered
  /// out where rendered).
  final List<String> order;
  final Set<String> hiddenIds;

  ModulePrefs copyWith({List<String>? order, Set<String>? hiddenIds}) =>
      ModulePrefs(order: order ?? this.order, hiddenIds: hiddenIds ?? this.hiddenIds);
}

class ModulePrefsNotifier extends StateNotifier<ModulePrefs> {
  ModulePrefsNotifier() : super(ModulePrefs(order: kModuleTaxonomy.map((m) => m.id).toList(), hiddenIds: {}));

  /// oldIndex/newIndex come from ReorderableListView's onReorderItem, which
  /// already adjusts newIndex for the removed item — no manual -1 needed.
  void reorder(int oldIndex, int newIndex) {
    final updated = [...state.order];
    final id = updated.removeAt(oldIndex);
    updated.insert(newIndex, id);
    state = state.copyWith(order: updated);
  }

  void toggleHidden(String moduleId) {
    final updated = {...state.hiddenIds};
    if (!updated.add(moduleId)) updated.remove(moduleId);
    state = state.copyWith(hiddenIds: updated);
  }
}

final modulePrefsProvider = StateNotifierProvider<ModulePrefsNotifier, ModulePrefs>((ref) => ModulePrefsNotifier());

/// kModuleTaxonomy reordered per user prefs, hidden modules excluded.
/// Everything that renders the module list (rail, overview page) should
/// read through this instead of kModuleTaxonomy directly.
List<ModuleSection> visibleModulesInOrder(ModulePrefs prefs) {
  final byId = {for (final m in kModuleTaxonomy) m.id: m};
  return [
    for (final id in prefs.order)
      if (!prefs.hiddenIds.contains(id) && byId.containsKey(id)) byId[id]!,
  ];
}
