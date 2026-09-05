import { create } from 'zustand'
import {
  fetchCapabilities,
  probeBackend,
  resetBackendConnection,
  type CapabilitiesInfo,
  type HealthInfo,
} from '@/adapters/backend/backendClient'
import { resetSseConnection } from '@/adapters/backend/sseClient'

/** Re-resolve the endpoint + token before a retry — covers a sidecar that
 * respawned (Tauri) or a hosted endpoint override that changed. Cheap. */
function dropCachedConnection() {
  resetBackendConnection()
  resetSseConnection()
}

export type BackendStatus = 'unknown' | 'connecting' | 'available' | 'unavailable'

interface BackendStore {
  status: BackendStatus
  /** A connect attempt is in flight (used by the "backend unavailable" UIs). */
  reconnecting: boolean
  health: HealthInfo | null
  capabilities: CapabilitiesInfo | null
  /** Probe the backend and refresh capabilities. Safe to call repeatedly. */
  refresh: () => Promise<void>
  /** Drop the cached connection and probe again (the "Retry" button). */
  retry: () => Promise<void>
  /**
   * Start a self-healing connect loop: probe fast (~1s) until connected, then
   * keep a slow keep-alive poll so a backend restart is picked up without a
   * manual Retry. Idempotent — call once at app start.
   */
  startAutoConnect: () => void
  /** Whether a specific tool id is runnable right now. */
  toolAvailable: (toolId: string) => boolean
}

// The desktop app spawns its sidecar asynchronously (~300 ms to LISTENING, but
// Tauri/WebView init timing means the first probe can still lose the race).
// Fast retries cover the warm-up, then it settles into a slow keep-alive.
const FAST_MS = 1_000
const FAST_TRIES = 20 // ~20 s of fast retries before backing off
const SLOW_MS = 15_000

let loopStarted = false
let tries = 0

/**
 * Tracks whether the network backend is reachable and which tools it can run.
 * Network tool screens read `status` to decide between their normal UI and a
 * "backend unavailable" state; the 44 client-only tools ignore this entirely.
 * Not persisted — it is a live runtime fact.
 */
export const useBackendStore = create<BackendStore>((set, get) => ({
  status: 'unknown',
  reconnecting: false,
  health: null,
  capabilities: null,

  refresh: async () => {
    if (get().status === 'unknown') set({ status: 'connecting' })
    set({ reconnecting: true })
    const health = await probeBackend()
    if (!health) {
      set({ status: 'unavailable', reconnecting: false, health: null, capabilities: null })
      return
    }
    const capabilities = await fetchCapabilities()
    set({ status: 'available', reconnecting: false, health, capabilities })
  },

  retry: async () => {
    dropCachedConnection()
    tries = 0
    set({ status: 'unknown' })
    await get().refresh()
  },

  startAutoConnect: () => {
    if (loopStarted) return
    loopStarted = true
    const tick = async () => {
      if (get().status !== 'available') dropCachedConnection()
      await get().refresh()
      const connected = get().status === 'available'
      if (connected) tries = 0
      else tries++ // a backend that dropped after connecting re-enters this path
      const delay = connected ? SLOW_MS : tries <= FAST_TRIES ? FAST_MS : SLOW_MS
      setTimeout(tick, delay)
    }
    void tick()
  },

  toolAvailable: (toolId) => {
    const caps = get().capabilities
    if (!caps) return false
    return caps.capabilities[toolId]?.available ?? false
  },
}))
