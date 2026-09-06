/**
 * Monitors module store. Polls `GET /monitors` while the board is open, holds
 * the samples for the monitor in the detail pane, and raises an in-app toast on
 * a down / recovered transition (M1 alerting — a webhook is M2).
 */
import { create } from 'zustand'
import * as api from '@/adapters/backend/monitorClient'
import type { Monitor, MonitorSample } from '@/core/monitor/monitorModel'
import { useBackendStore } from './backendStore'
import { reportError } from './errorStore'

const SRC = 'Monitors'
const POLL_MS = 10_000

interface MonitorState {
  monitors: Monitor[]
  loaded: boolean
  error: string | null
  selectedId: string | null
  samples: MonitorSample[]
  samplesFor: string | null

  refresh: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
  select: (id: string | null) => Promise<void>
  loadSamples: (id: string) => Promise<void>
  save: (m: Partial<Monitor>) => Promise<Monitor | null>
  remove: (id: string) => Promise<void>
  setPaused: (id: string, paused: boolean) => Promise<void>
  checkNow: (id: string) => Promise<void>
}

let timer: ReturnType<typeof setInterval> | null = null
/** last-seen lastChangeAt per monitor, to fire a toast once per transition */
const seenChange = new Map<string, number>()

function announce(next: Monitor[]) {
  for (const m of next) {
    const known = seenChange.get(m.id)
    seenChange.set(m.id, m.lastChangeAt)
    if (known === undefined) continue // first sighting — don't alert on load
    if (m.lastChangeAt <= known) continue
    // Only "down" is an alert. Recovery shows on the board + event log; M2's
    // webhook covers both directions for real notification.
    if (m.status === 'down') {
      reportError(
        {
          code: 'unreachable',
          title: `Monitor down — ${m.name}`,
          detail: `${m.kind} · ${m.target}`,
          retryable: false,
        },
        SRC,
      )
    }
  }
}

export const useMonitorStore = create<MonitorState>((set, get) => ({
  monitors: [],
  loaded: false,
  error: null,
  selectedId: null,
  samples: [],
  samplesFor: null,

  refresh: async () => {
    if (useBackendStore.getState().status !== 'available') return
    try {
      const next = await api.listMonitors()
      announce(next)
      set({ monitors: next, loaded: true, error: null })
      const sel = get().selectedId
      if (sel && next.some((m) => m.id === sel)) void get().loadSamples(sel)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loaded: true })
    }
  },

  startPolling: () => {
    if (timer) return
    void get().refresh()
    timer = setInterval(() => void get().refresh(), POLL_MS)
  },

  stopPolling: () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  },

  select: async (id) => {
    set({ selectedId: id, samples: id === get().samplesFor ? get().samples : [] })
    if (id) await get().loadSamples(id)
  },

  loadSamples: async (id) => {
    try {
      const samples = await api.monitorSamples(id, 0, 1000)
      set({ samples, samplesFor: id })
    } catch {
      /* leave stale */
    }
  },

  save: async (m) => {
    try {
      const saved = await api.saveMonitor(m)
      await get().refresh()
      return saved
    } catch (e) {
      reportError(e, SRC)
      return null
    }
  },

  remove: async (id) => {
    try {
      await api.deleteMonitor(id)
      seenChange.delete(id)
      if (get().selectedId === id) set({ selectedId: null, samples: [], samplesFor: null })
      await get().refresh()
    } catch (e) {
      reportError(e, SRC)
    }
  },

  setPaused: async (id, paused) => {
    try {
      await api.pauseMonitor(id, paused)
      await get().refresh()
    } catch (e) {
      reportError(e, SRC)
    }
  },

  checkNow: async (id) => {
    try {
      await api.checkMonitor(id)
      await get().refresh()
      await get().loadSamples(id)
    } catch (e) {
      reportError(e, SRC)
    }
  },
}))
