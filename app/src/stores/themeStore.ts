import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createStoragePort } from '@/adapters/storage/createStoragePort'
import { storagePortAsZustandStorage } from '@/adapters/storage/zustandStorage'

export type ThemeMode = 'light' | 'dark'

interface ThemeStore {
  mode: ThemeMode
  toggle: () => void
  reset: () => void
}

/**
 * Mirrors theme_provider.dart's themeModeProvider — defaults to dark.
 * Persisted through IStoragePort (Phase 6), unlike the in-memory-only
 * Flutter version.
 */
export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      mode: 'dark',
      toggle: () => set((s) => ({ mode: s.mode === 'dark' ? 'light' : 'dark' })),
      reset: () => set({ mode: 'dark' }),
    }),
    {
      name: 'theme',
      storage: createJSONStorage(() => storagePortAsZustandStorage(createStoragePort())),
    },
  ),
)
