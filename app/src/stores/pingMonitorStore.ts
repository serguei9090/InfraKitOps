/**
 * Ping Monitor run state, hoisted out of the screen component so a session
 * survives in-app navigation (BACKGROUND_RUNS_PLAN.md Tier 1): start pinging a
 * set of hosts, go run an Ansible task, come back — the chart is gap-free
 * because the SSE stream lives here, not in the unmounted screen.
 *
 * Not persisted, and not server-side: closing the tab / a full reload still
 * ends the session (that's Tier 2, deliberately out of scope).
 */
import { create } from 'zustand'
import { openStream } from '@/adapters/backend/sseClient'
import type { PingSample, PingStats } from '@/core/network/toolResults'

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6']
const MAX_POINTS = 5000

export interface HostTrack {
  host: string
  color: string
  stats: PingStats | null
  points: { t: number; ms: number | null }[]
}

interface PingMonitorState {
  running: boolean
  error: string | null
  hosts: string[]
  intervalMs: number
  downThreshold: number
  startedAt: number | null
  tracks: Map<string, HostTrack>
  abort: () => void

  /** Open (or re-open) the stream for `hosts`. Existing host tracks are kept so
   *  the chart shows no gap across a host add/remove reconnect. */
  start: (hosts: string[], opts: { intervalMs: number; downThreshold: number }) => void
  addHost: (host: string) => void
  removeHost: (host: string) => void
  stop: () => void
  /** Replace the tracks with a restored history run (no stream). */
  restore: (tracks: Map<string, HostTrack>, hosts: string[]) => void
}

function foldEvent(tracks: Map<string, HostTrack>, name: string, data: unknown): Map<string, HostTrack> {
  const next = new Map(tracks)
  if (name === 'sample') {
    const s = data as PingSample
    const tr = next.get(s.host)
    if (tr) {
      const points = [...tr.points, { t: Date.now(), ms: s.ok ? s.rttMs : null }]
      next.set(s.host, { ...tr, points: points.length > MAX_POINTS ? points.slice(-MAX_POINTS) : points })
    }
  } else if (name === 'stats' || name === 'status') {
    const st = data as PingStats
    const tr = next.get(st.host)
    if (tr) next.set(st.host, { ...tr, stats: st })
  }
  return next
}

export const usePingMonitorStore = create<PingMonitorState>((set, get) => {
  const open = (hosts: string[], preserve: boolean) => {
    get().abort()
    const prev = get().tracks
    const tracks = new Map<string, HostTrack>()
    hosts.forEach((h, i) => {
      tracks.set(h, (preserve && prev.get(h)) || { host: h, color: COLORS[i % COLORS.length], stats: null, points: [] })
    })
    set({
      running: true,
      error: null,
      hosts,
      tracks,
      startedAt: get().startedAt ?? Date.now(),
    })
    const { intervalMs, downThreshold } = get()
    const abort = openStream(
      '/ping-monitor/stream',
      { hosts: hosts.join(';'), intervalMs: String(intervalMs), downThreshold: String(downThreshold) },
      {
        onEvent: (name, data) => {
          if (name === 'error') {
            const msg =
              typeof data === 'object' && data && 'error' in data
                ? String((data as { error: unknown }).error)
                : 'stream error'
            set({ error: msg, running: false })
            return
          }
          set((s) => ({ tracks: foldEvent(s.tracks, name, data) }))
        },
        // The stream only closes on our abort (host change / stop) or a real
        // transport drop; a clean server close would mean the backend stopped.
        onClose: () => set((s) => (s.running ? { running: false } : s)),
        onError: (e) => set({ error: e.message, running: false }),
      },
    )
    set({ abort })
  }

  return {
    running: false,
    error: null,
    hosts: [],
    intervalMs: 1000,
    downThreshold: 3,
    startedAt: null,
    tracks: new Map(),
    abort: () => {},

    start: (hosts, opts) => {
      if (hosts.length === 0) return
      set({ intervalMs: opts.intervalMs, downThreshold: opts.downThreshold, startedAt: Date.now() })
      open(hosts, false)
    },

    addHost: (raw) => {
      const h = raw.trim()
      if (!h || get().hosts.includes(h)) return
      open([...get().hosts, h], true)
    },

    removeHost: (h) => {
      const next = get().hosts.filter((x) => x !== h)
      if (next.length === 0) {
        get().stop()
        return
      }
      open(next, true)
    },

    stop: () => {
      get().abort()
      set({ running: false, abort: () => {} })
    },

    restore: (tracks, hosts) => {
      get().abort()
      set({ tracks, hosts, running: false, error: null, startedAt: null, abort: () => {} })
    },
  }
})
