/**
 * Runbooks module — library + run state. Everything is backend-side; this
 * store is a thin cache + the live-run buffer. Not persisted.
 * See RUNBOOK_MODULE_PLAN.md §7.
 */
import { create } from 'zustand'
import * as api from '@/adapters/backend/runbookClient'
import { emptySpec, type Runbook, type RunStep } from '@/core/runbook/runbookModel'

export type Section = 'library' | 'history' | 'nodes' | 'packages' | 'assistant'

/** A run currently streaming in the UI. */
export interface LiveRun {
  runbookId: string
  runId: number | null
  status: 'starting' | 'running' | 'ok' | 'failed' | 'partial' | 'error'
  steps: RunStep[]
  /** free-flowing stdout/stderr lines as they arrive, per step index */
  log: { stepIndex: number; stream: 'stdout' | 'stderr'; text: string }[]
  error?: string
  abort: () => void
}

interface RunbookStore {
  section: Section
  runbooks: Runbook[]
  loaded: boolean
  error: string | null
  live: LiveRun | null

  setSection: (s: Section) => void
  refresh: () => Promise<void>
  createStarter: () => Promise<Runbook | null>
  remove: (id: string) => Promise<void>
  saveVersion: (id: string, note?: string) => Promise<void>
  setPublished: (id: string, published: boolean) => Promise<void>

  startRun: (
    runbookId: string,
    opts: { args: Record<string, string>; dryRun?: boolean; asAuthor?: boolean },
  ) => void
  clearLive: () => void
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export const useRunbookStore = create<RunbookStore>((set, get) => ({
  section: 'library',
  runbooks: [],
  loaded: false,
  error: null,
  live: null,

  setSection: (section) => set({ section }),

  refresh: async () => {
    try {
      const runbooks = await api.listRunbooks()
      set({ runbooks, loaded: true, error: null })
    } catch (e) {
      set({ loaded: true, error: msg(e) })
    }
  },

  createStarter: async () => {
    try {
      const spec = emptySpec('New runbook')
      spec.steps[0].name = 'Say hello'
      spec.steps[0].script = 'echo "hello from {{WHO}}"'
      spec.args = [{ name: 'WHO', label: 'Who', type: 'string', required: true, default: 'runbook' }]
      const rb = await api.createRunbook(spec)
      await get().refresh()
      return rb
    } catch (e) {
      set({ error: msg(e) })
      return null
    }
  },

  remove: async (id) => {
    await api.deleteRunbook(id)
    await get().refresh()
  },

  saveVersion: async (id, note) => {
    await api.saveVersion(id, note)
    await get().refresh()
  },

  setPublished: async (id, published) => {
    await api.setPublished(id, published)
    await get().refresh()
  },

  startRun: (runbookId, opts) => {
    // Abort any run already streaming.
    get().live?.abort()

    const live: LiveRun = {
      runbookId,
      runId: null,
      status: 'starting',
      steps: [],
      log: [],
      abort: () => {},
    }
    const abort = api.openRunStream(runbookId, opts, {
      onEvent: (name, data) => {
        const d = data as Record<string, unknown>
        set((s) => {
          if (!s.live || s.live.runbookId !== runbookId) return s
          const next = { ...s.live, steps: [...s.live.steps], log: [...s.live.log] }
          switch (name) {
            case 'run-start':
              next.runId = (d.runId as number) ?? null
              next.status = 'running'
              break
            case 'step-start':
              // placeholder row so the UI shows the step immediately
              next.steps.push({
                index: d.index as number,
                name: (d.name as string) ?? `Step ${d.index}`,
                executor: (d.executor as string) ?? '',
                commandRedacted: (d.command as string) ?? '',
                stdout: '',
                stderr: '',
                exitCode: 0,
                status: 'running',
                startedAt: Date.now(),
                finishedAt: 0,
              })
              break
            case 'stdout':
            case 'stderr':
              next.log.push({
                stepIndex: next.steps.at(-1)?.index ?? 0,
                stream: name,
                text: (d.text as string) ?? '',
              })
              break
            case 'step-end': {
              const rs = data as RunStep
              const i = next.steps.findIndex((x) => x.index === rs.index)
              if (i >= 0) next.steps[i] = rs
              else next.steps.push(rs)
              break
            }
            case 'run-end':
              next.status =
                (d.dryRun ? 'ok' : (d.status as LiveRun['status'])) ?? 'ok'
              break
            case 'preview':
              // dry-run payload; the RunPanel reads it off `live` if needed
              break
            case 'error':
              next.status = 'error'
              next.error =
                (d.error as string) ?? 'run failed'
              break
          }
          return { live: next }
        })
      },
      onClose: () => {
        set((s) => {
          if (!s.live || s.live.status === 'error') return s
          if (s.live.status === 'starting' || s.live.status === 'running') {
            return { live: { ...s.live, status: 'ok' } }
          }
          return s
        })
      },
      onError: (err) => {
        set((s) => (s.live ? { live: { ...s.live, status: 'error', error: err.message } } : s))
      },
    })
    live.abort = abort
    set({ live })
  },

  clearLive: () => {
    get().live?.abort()
    set({ live: null })
  },
}))
