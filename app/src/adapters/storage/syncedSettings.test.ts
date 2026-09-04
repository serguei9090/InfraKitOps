import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getUserSettings = vi.fn()
const putUserSettings = vi.fn()
vi.mock('@/adapters/backend/userSettingsClient', () => ({
  getUserSettings: () => getUserSettings(),
  putUserSettings: (p: unknown) => putUserSettings(p),
}))

const mem = new Map<string, string>()
vi.mock('./createStoragePort', () => ({
  createStoragePort: () => ({
    get: async (k: string) => mem.get(k) ?? null,
    set: async (k: string, v: string) => {
      mem.set(k, v)
    },
    remove: async (k: string) => {
      mem.delete(k)
    },
  }),
}))

describe('syncedSettings', () => {
  beforeEach(() => {
    vi.resetModules()
    getUserSettings.mockReset()
    putUserSettings.mockReset().mockResolvedValue({})
    mem.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes locally always; pushes to the server only once sync is enabled', async () => {
    const mod = await import('./syncedSettings')
    const store = mod.syncedStorage()

    await store.setItem('theme', 'v1')
    await vi.runAllTimersAsync()
    expect(mem.get('theme')).toBe('v1')
    expect(putUserSettings).not.toHaveBeenCalled()

    getUserSettings.mockResolvedValue({})
    await mod.pullSettings()
    await store.setItem('theme', 'v2')
    await vi.runAllTimersAsync()
    expect(putUserSettings).toHaveBeenCalledWith({ theme: 'v2' })

    putUserSettings.mockClear()
    await store.setItem('not-synced', 'x')
    await vi.runAllTimersAsync()
    expect(putUserSettings).not.toHaveBeenCalled()
  })

  it('pullSettings writes newer server values into local storage', async () => {
    const mod = await import('./syncedSettings')
    mem.set('network-settings', '{"state":{},"version":0}')
    const fresh = '{"state":{"extraToolIds":["x"]},"version":0}'
    getUserSettings.mockResolvedValue({ 'network-settings': fresh })

    await mod.pullSettings()
    await vi.runAllTimersAsync()

    expect(mem.get('network-settings')).toBe(fresh)
  })

  it('stopSync halts further pushes', async () => {
    const mod = await import('./syncedSettings')
    getUserSettings.mockResolvedValue({})
    await mod.pullSettings()
    mod.stopSync()

    await mod.syncedStorage().setItem('theme', 'z')
    await vi.runAllTimersAsync()
    expect(putUserSettings).not.toHaveBeenCalled()
  })

  it('exposes the synced key set', async () => {
    const mod = await import('./syncedSettings')
    expect([...mod.SYNCED_KEYS].sort()).toEqual(
      ['module-prefs', 'network-settings', 'shortcuts', 'theme'].sort(),
    )
  })
})
