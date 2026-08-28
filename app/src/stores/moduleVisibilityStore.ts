import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { kModuleTaxonomy, type ModuleDef } from '@/adapters/ui/shell/moduleTaxonomy'
import { createStoragePort } from '@/adapters/storage/createStoragePort'
import { storagePortAsZustandStorage } from '@/adapters/storage/zustandStorage'

interface ModuleVisibilityStore {
  order: string[]
  hiddenIds: string[]
  /** Whether the module rail shows names next to icons (vs icon-only). */
  railExpanded: boolean
  reorder: (oldIndex: number, newIndex: number) => void
  toggleHidden: (moduleId: string) => void
  toggleRailExpanded: () => void
}

/**
 * User's module ordering + hide/show choices for the rail and "All Tools"
 * overview. Mirrors module_visibility_provider.dart. Persisted through
 * IStoragePort (Phase 6) — localStorage on web, a real file on desktop —
 * so it now survives a reload, unlike the in-memory-only Flutter version.
 */
export const useModuleVisibilityStore = create<ModuleVisibilityStore>()(
  persist(
    (set) => ({
      order: kModuleTaxonomy.map((m) => m.id),
      hiddenIds: [],
      railExpanded: false,
      toggleRailExpanded: () => set((s) => ({ railExpanded: !s.railExpanded })),
      reorder: (oldIndex, newIndex) =>
        set((s) => {
          const updated = [...s.order]
          const [id] = updated.splice(oldIndex, 1)
          updated.splice(newIndex, 0, id)
          return { order: updated }
        }),
      toggleHidden: (moduleId) =>
        set((s) => ({
          hiddenIds: s.hiddenIds.includes(moduleId)
            ? s.hiddenIds.filter((id) => id !== moduleId)
            : [...s.hiddenIds, moduleId],
        })),
    }),
    {
      name: 'module-prefs',
      storage: createJSONStorage(() => storagePortAsZustandStorage(createStoragePort())),
      // New/removed modules since a prefs snapshot was saved shouldn't
      // vanish from `order` or silently break `visibleModulesInOrder` —
      // reconcile against the current taxonomy on every load instead of
      // trusting the persisted list verbatim.
      merge: (persisted, current) => {
        const saved = persisted as Partial<ModuleVisibilityStore> | undefined
        const knownIds = kModuleTaxonomy.map((m) => m.id)
        const savedOrder = saved?.order?.filter((id) => knownIds.includes(id)) ?? []
        const missing = knownIds.filter((id) => !savedOrder.includes(id))
        return {
          ...current,
          order: [...savedOrder, ...missing],
          hiddenIds: saved?.hiddenIds?.filter((id) => knownIds.includes(id)) ?? current.hiddenIds,
          railExpanded: saved?.railExpanded ?? current.railExpanded,
        }
      },
    },
  ),
)

/**
 * kModuleTaxonomy reordered per user prefs, hidden modules excluded.
 * Everything that renders the module list (rail, overview page) should read
 * through this instead of kModuleTaxonomy directly.
 */
export function visibleModulesInOrder(order: string[], hiddenIds: string[]): ModuleDef[] {
  const byId = new Map(kModuleTaxonomy.map((m) => [m.id, m]))
  return order
    .filter((id) => !hiddenIds.includes(id) && byId.has(id))
    .map((id) => byId.get(id)!)
}
