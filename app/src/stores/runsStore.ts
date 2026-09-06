import { create } from 'zustand'
import { listActiveRuns, type ActiveRun, type RunModule } from '@/adapters/backend/runsClient'
import { useBackendStore } from './backendStore'

/**
 * Tracks the caller's server-side background runs (BACKGROUND_RUNS_PLAN.md).
 * Polls `GET /runs/active` — fast while something is running or the drawer is
 * open, slow otherwise. A run keeps executing on the backend regardless of
 * which screen (if any) is watching it.
 */
interface RunsState {
  active: ActiveRun[]
  /** timestamp the Runs drawer was last opened — badge counts newer runs */
  seenIds: number[]
  drawerOpen: boolean
  /** a run id a module console should re-attach its live view to on mount */
  attachRequest: { module: RunModule; id: number } | null
  refresh: () => Promise<void>
  startPolling: () => void
  setDrawerOpen: (open: boolean) => void
  requestAttach: (module: RunModule, id: number) => void
  /** module console calls this on mount; returns the pending run id for it, once */
  consumeAttach: (module: RunModule) => number | null
}

const FAST_MS = 4_000
const SLOW_MS = 20_000
let loopStarted = false

export const useRunsStore = create<RunsState>((set, get) => ({
  active: [],
  seenIds: [],
  drawerOpen: false,
  attachRequest: null,

  refresh: async () => {
    if (useBackendStore.getState().status !== 'available') {
      if (get().active.length) set({ active: [] })
      return
    }
    try {
      set({ active: await listActiveRuns() })
    } catch {
      /* transient — keep the last-known list */
    }
  },

  startPolling: () => {
    if (loopStarted) return
    loopStarted = true
    const tick = async () => {
      await get().refresh()
      const busy = get().active.length > 0 || get().drawerOpen
      setTimeout(tick, busy ? FAST_MS : SLOW_MS)
    }
    void tick()
  },

  setDrawerOpen: (open) =>
    set((s) => ({
      drawerOpen: open,
      seenIds: open ? s.active.map((r) => r.id) : s.seenIds,
    })),

  requestAttach: (module, id) => set({ attachRequest: { module, id } }),

  consumeAttach: (module) => {
    const req = get().attachRequest
    if (!req || req.module !== module) return null
    set({ attachRequest: null })
    return req.id
  },
}))
