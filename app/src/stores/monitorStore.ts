/**
 * Monitors module store. Polls `GET /monitors` while the board is open, holds
 * the detail-pane samples, mirrors the alert settings, and consumes the
 * `/monitors/stream` SSE for live status changes + an in-app toast.
 */
import { create } from 'zustand'
import * as api from '@/adapters/backend/monitorClient'
import {
  defaultMonitorSettings,
  type Monitor,
  type MonitorAlert,
  type MonitorSample,
  type MonitorSettings,
} from '@/core/monitor/monitorModel'
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
  tagFilter: string | null
  settings: MonitorSettings

  refresh: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
  setTagFilter: (tag: string | null) => void
  select: (id: string | null) => Promise<void>
  loadSamples: (id: string) => Promise<void>
  save: (m: Partial<Monitor>) => Promise<Monitor | null>
  remove: (id: string) => Promise<void>
  setPaused: (id: string, paused: boolean) => Promise<void>
  checkNow: (id: string) => Promise<void>
  checkAll: () => Promise<void>
  mute: (id: string, untilMs: number) => Promise<void>
  unmute: (id: string) => Promise<void>
  loadSettings: () => Promise<void>
  saveSettings: (s: MonitorSettings) => Promise<boolean>
  testChannel: (channel?: string) => Promise<boolean>
}

let timer: ReturnType<typeof setInterval> | null = null
let stopStream: (() => void) | null = null
/** last-seen lastChangeAt per monitor, to fire a toast once per transition */
const seenChange = new Map<string, number>()

function toastDown(m: { name: string; kind: string; target: string }) {
  reportError(
    { code: 'unreachable', title: `Monitor down — ${m.name}`, detail: `${m.kind} · ${m.target}`, retryable: false },
    SRC,
  )
}

function announce(next: Monitor[]) {
  for (const m of next) {
    const known = seenChange.get(m.id)
    seenChange.set(m.id, m.lastChangeAt)
    if (known === undefined || m.lastChangeAt <= known) continue
    if (m.status === 'down' && (m.mutedUntil ?? 0) <= Date.now()) toastDown(m)
  }
}

export const useMonitorStore = create<MonitorState>((set, get) => ({
  monitors: [],
  loaded: false,
  error: null,
  selectedId: null,
  samples: [],
  samplesFor: null,
  tagFilter: null,
  settings: defaultMonitorSettings(),

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
    void get().loadSettings()
    timer = setInterval(() => void get().refresh(), POLL_MS)
    stopStream = api.openMonitorStream({
      onEvent: (name, data) => {
        if (name !== 'monitor-alert') return
        const a = data as MonitorAlert
        if (a.event === 'down') toastDown(a)
        void get().refresh()
      },
      onError: () => {
        /* the poll keeps the board fresh; the stream reconnects on its own */
      },
    })
  },

  stopPolling: () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    stopStream?.()
    stopStream = null
  },

  setTagFilter: (tag) => set({ tagFilter: tag }),

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

  checkAll: async () => {
    try {
      await api.checkAllMonitors()
      setTimeout(() => void get().refresh(), 1500)
    } catch (e) {
      reportError(e, SRC)
    }
  },

  mute: async (id, untilMs) => {
    try {
      await api.muteMonitor(id, untilMs)
      await get().refresh()
    } catch (e) {
      reportError(e, SRC)
    }
  },

  unmute: async (id) => {
    try {
      await api.unmuteMonitor(id)
      await get().refresh()
    } catch (e) {
      reportError(e, SRC)
    }
  },

  loadSettings: async () => {
    try {
      set({ settings: await api.getMonitorSettings() })
    } catch {
      /* keep defaults */
    }
  },

  saveSettings: async (s) => {
    try {
      set({ settings: await api.putMonitorSettings(s) })
      return true
    } catch (e) {
      reportError(e, SRC)
      return false
    }
  },

  testChannel: async (channel) => {
    try {
      await api.testMonitorChannel(channel)
      return true
    } catch (e) {
      reportError(e, SRC)
      return false
    }
  },
}))
