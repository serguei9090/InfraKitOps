/**
 * S3d — per-device keyboard-shortcut overrides. Persisted through IStoragePort.
 * The resolved combo for an id is `overrides[id] ?? SHORTCUTS default`.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { syncedStorage } from '@/adapters/storage/syncedSettings'
import { SHORTCUTS, shortcutById } from '@/core/shortcuts/shortcuts'

const SHORTCUT_IDS = SHORTCUTS.map((s) => s.id)

interface ShortcutStore {
  overrides: Record<string, string>
  /** the combo currently bound to `id` (override or default) */
  combo: (id: string) => string
  setOverride: (id: string, combo: string) => void
  resetOne: (id: string) => void
  resetAll: () => void
  /** ids whose combo collides with `combo`, excluding `exceptId` */
  conflicts: (combo: string, exceptId: string) => string[]
}

export const useShortcutStore = create<ShortcutStore>()(
  persist(
    (set, get) => ({
      overrides: {},

      combo: (id) => get().overrides[id] ?? shortcutById(id)?.defaultCombo ?? '',

      setOverride: (id, combo) => set((s) => ({ overrides: { ...s.overrides, [id]: combo } })),

      resetOne: (id) =>
        set((s) => {
          const next = { ...s.overrides }
          delete next[id]
          return { overrides: next }
        }),

      resetAll: () => set({ overrides: {} }),

      conflicts: (combo, exceptId) => {
        const c = get().combo
        return SHORTCUT_IDS.filter((id) => id !== exceptId && c(id) === combo)
      },
    }),
    {
      name: 'shortcuts',
      storage: createJSONStorage(() => syncedStorage()),
    },
  ),
)
