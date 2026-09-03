/**
 * Per-user settings sync (DEPLOY_PLAN.md D5).
 *
 * When the backend runs with `--auth on`, a handful of client-only prefs
 * (theme, module order/visibility, keyboard shortcuts, network tool blob)
 * follow the user's login across browsers instead of living only in one
 * browser's storage.
 *
 * Mechanism: `syncedStorage()` wraps the normal `IStoragePort` zustand
 * adapter — writes still go to local storage AND get debounce-pushed to the
 * server blob. On login (and on boot when already signed in) `pullSettings()`
 * fetches the blob, writes any newer keys locally, and rehydrates the
 * affected stores so the UI reflects them without a reload.
 *
 * The backend-endpoint override is deliberately NOT synced — it is the
 * setting that tells the client which backend to reach, so it has to be
 * per-device.
 */
import type { StateStorage } from 'zustand/middleware'
import { createStoragePort } from './createStoragePort'
import { getUserSettings, putUserSettings } from '@/adapters/backend/userSettingsClient'

/** zustand `persist` names of the stores that sync. */
export const SYNCED_KEYS = ['theme', 'module-prefs', 'shortcuts', 'network-settings'] as const
type SyncedKey = (typeof SYNCED_KEYS)[number]

const isSynced = (name: string): name is SyncedKey =>
  (SYNCED_KEYS as readonly string[]).includes(name)

const port = createStoragePort()

let enabled = false // true only while signed in under --auth on
let suppressPush = false // set while we write pulled values back
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Storage adapter for a synced zustand store. */
export function syncedStorage(): StateStorage {
  return {
    getItem: (name) => port.get(name),
    setItem: (name, value) => {
      const p = port.set(name, value)
      if (enabled && !suppressPush && isSynced(name)) schedulePush(name, value)
      return p
    },
    removeItem: (name) => {
      if (enabled && !suppressPush && isSynced(name)) schedulePush(name, null)
      return port.remove(name)
    },
  }
}

function schedulePush(name: string, value: string | null) {
  const existing = timers.get(name)
  if (existing) clearTimeout(existing)
  timers.set(
    name,
    setTimeout(() => {
      timers.delete(name)
      void putUserSettings({ [name]: value }).catch(() => {
        /* offline / transient — local storage still holds the value */
      })
    }, 800),
  )
}

/**
 * Fetch the server blob, apply any keys that differ from local, and rehydrate
 * those stores. Call after a successful login and once on boot when a session
 * is already active. Safe to call more than once.
 */
export async function pullSettings(): Promise<void> {
  enabled = true
  let blob: Record<string, string>
  try {
    blob = await getUserSettings()
  } catch {
    return // no endpoint / offline — keep local
  }
  const changed: SyncedKey[] = []
  for (const key of SYNCED_KEYS) {
    const remote = blob[key]
    if (remote == null) continue
    if (remote !== (await port.get(key))) {
      suppressPush = true
      try {
        await port.set(key, remote)
      } finally {
        suppressPush = false
      }
      changed.push(key)
    }
  }
  if (changed.length) await rehydrate(changed)
}

/** Turn sync off (logout) — later local edits stay local. */
export function stopSync(): void {
  enabled = false
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
}

async function rehydrate(keys: SyncedKey[]): Promise<void> {
  const [theme, modules, shortcuts, network] = await Promise.all([
    import('@/stores/themeStore'),
    import('@/stores/moduleVisibilityStore'),
    import('@/stores/shortcutStore'),
    import('@/stores/networkSettingsStore'),
  ])
  type Rehydratable = { persist: { rehydrate: () => Promise<void> | void } }
  const byKey: Record<SyncedKey, Rehydratable> = {
    theme: theme.useThemeStore as unknown as Rehydratable,
    'module-prefs': modules.useModuleVisibilityStore as unknown as Rehydratable,
    shortcuts: shortcuts.useShortcutStore as unknown as Rehydratable,
    'network-settings': network.useNetworkSettingsStore as unknown as Rehydratable,
  }
  suppressPush = true
  try {
    await Promise.all(keys.map((k) => byKey[k]?.persist.rehydrate()))
  } finally {
    suppressPush = false
  }
}
