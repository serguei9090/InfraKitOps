import { create } from 'zustand'
import {
  fetchCapabilities,
  probeBackend,
  resetBackendConnection,
  type CapabilitiesInfo,
  type HealthInfo,
} from '@/adapters/backend/backendClient'

export type BackendStatus = 'unknown' | 'connecting' | 'available' | 'unavailable'

interface BackendStore {
  status: BackendStatus
  health: HealthInfo | null
  capabilities: CapabilitiesInfo | null
  /** Probe the backend and refresh capabilities. Safe to call repeatedly. */
  refresh: () => Promise<void>
  /** Drop the cached connection and probe again (the "Retry" button). */
  retry: () => Promise<void>
  /** Whether a specific tool id is runnable right now. */
  toolAvailable: (toolId: string) => boolean
}

/**
 * Tracks whether the network backend is reachable and which tools it can run.
 * Network tool screens read `status` to decide between their normal UI and a
 * "backend unavailable" state; the 44 client-only tools ignore this entirely.
 * Not persisted — it is a live runtime fact.
 */
export const useBackendStore = create<BackendStore>((set, get) => ({
  status: 'unknown',
  health: null,
  capabilities: null,

  refresh: async () => {
    if (get().status === 'unknown') set({ status: 'connecting' })
    const health = await probeBackend()
    if (!health) {
      set({ status: 'unavailable', health: null, capabilities: null })
      return
    }
    const capabilities = await fetchCapabilities()
    set({ status: 'available', health, capabilities })
  },

  retry: async () => {
    resetBackendConnection()
    set({ status: 'connecting' })
    await get().refresh()
  },

  toolAvailable: (toolId) => {
    const caps = get().capabilities
    if (!caps) return false
    return caps.capabilities[toolId]?.available ?? false
  },
}))
