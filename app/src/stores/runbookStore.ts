/**
 * Runbooks module — library + run state. Everything is backend-side; this
 * store is a thin cache + the live-run buffer. Not persisted.
 * See RUNBOOK_MODULE_PLAN.md §7.
 */
import { create } from 'zustand'
import * as api from '@/adapters/backend/runbookClient'
import { openRunStream, cancelRun as apiCancelRun } from '@/adapters/backend/runsClient'
import {
  emptySpec,
  type Run,
  type Runbook,
  type RunSchedule,
  type RunStep,
  type SshNode,
} from '@/core/runbook/runbookModel'
import { classify } from '@/core/errors/appError'
import type { AppError } from '@/core/errors/appError'
import { reportError } from '@/stores/errorStore'

const SRC = 'Runbooks'

export type Section = 'library' | 'history' | 'schedules' | 'nodes' | 'packages' | 'assistant' | 'approvals'

/** A run currently streaming in the UI. */
export interface LiveRun {
  runbookId: string
  runId: number | null
  status: 'starting' | 'running' | 'awaiting_approval' | 'ok' | 'failed' | 'partial' | 'error'
  steps: RunStep[]
  /** free-flowing stdout/stderr lines as they arrive, per step index */
  log: { stepIndex: number; stream: 'stdout' | 'stderr'; text: string }[]
  error?: string
  /** classified form of `error`, for <InlineError> in the run panel */
  errorObj?: AppError
  abort: () => void
}

interface RunbookStore {
  section: Section
  runbooks: Runbook[]
  nodes: SshNode[]
  schedules: RunSchedule[]
  pendingApprovals: Run[]
  loaded: boolean
  error: string | null
  live: LiveRun | null

  setSection: (s: Section) => void
  refresh: () => Promise<void>
  refreshPendingApprovals: () => Promise<void>
  approveRun: (id: number, approved: boolean) => Promise<void>
  refreshNodes: () => Promise<void>
  putNode: (n: Partial<SshNode>) => Promise<void>
  deleteNode: (id: string) => Promise<void>
  refreshSchedules: () => Promise<void>
  putSchedule: (s: Partial<RunSchedule>) => Promise<void>
  deleteSchedule: (id: string) => Promise<void>
  createBlank: () => Promise<Runbook | null>
  remove: (id: string) => Promise<void>
  setPublished: (id: string, published: boolean) => Promise<void>

  startRun: (
    runbookId: string,
    opts: { args: Record<string, string>; dryRun?: boolean; asAuthor?: boolean },
  ) => void
  /** Re-attach the live view to a server-side run still executing (BR3b). */
  attachRun: (runId: number) => Promise<void>
  /** Ask the backend to cancel the run being viewed (not just close the view). */
  cancelLiveRun: () => Promise<void>
  clearLive: () => void
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export const useRunbookStore = create<RunbookStore>((set, get) => ({
  section: 'library',
  runbooks: [],
  nodes: [],
  schedules: [],
  pendingApprovals: [],
  loaded: false,
  error: null,
  live: null,

  setSection: (section) => set({ section }),

  refreshPendingApprovals: async () => {
    try {
      set({ pendingApprovals: await api.listPendingApprovals() })
    } catch {
      /* endpoint 503 in single-user or no runbook store — ignore */
    }
  },

  approveRun: async (id, approved) => {
    try {
      await api.approveRun(id, approved)
      await get().refreshPendingApprovals()
    } catch (e) {
      reportError(e, SRC)
    }
  },

  refresh: async () => {
    try {
      const runbooks = await api.listRunbooks()
      set({ runbooks, loaded: true, error: null })
    } catch (e) {
      set({ loaded: true, error: msg(e) })
    }
  },

  refreshNodes: async () => {
    try {
      set({ nodes: await api.listNodes() })
    } catch (e) {
      set({ error: msg(e) })
    }
  },

  putNode: async (n) => {
    try {
      await api.putNode(n)
      await get().refreshNodes()
    } catch (e) {
      reportError(e, SRC)
    }
  },

  deleteNode: async (id) => {
    try {
      await api.deleteNode(id)
      await get().refreshNodes()
    } catch (e) {
      reportError(e, SRC)
    }
  },

  refreshSchedules: async () => {
    try {
      set({ schedules: await api.listSchedules() })
    } catch (e) {
      set({ error: msg(e) })
    }
  },

  putSchedule: async (s) => {
    try {
      await api.putSchedule(s)
      await get().refreshSchedules()
    } catch (e) {
      reportError(e, SRC)
    }
  },

  deleteSchedule: async (id) => {
    try {
      await api.deleteSchedule(id)
      await get().refreshSchedules()
    } catch (e) {
      reportError(e, SRC)
    }
  },

  createBlank: async () => {
    try {
      const spec = emptySpec('New runbook')
      spec.steps[0].name = 'Step 1'
      const rb = await api.createRunbook(spec)
      await get().refresh()
      return rb
    } catch (e) {
      reportError(e, SRC)
      return null
    }
  },

  remove: async (id) => {
    try {
      await api.deleteRunbook(id)
      await get().refresh()
    } catch (e) {
      reportError(e, SRC)
    }
  },

  setPublished: async (id, published) => {
    try {
      await api.setPublished(id, published)
      await get().refresh()
    } catch (e) {
      reportError(e, SRC)
    }
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
    const abort = api.openRunStream(runbookId, opts, runStreamHandlers(set, runbookId))
    live.abort = abort
    set({ live })
  },

  attachRun: async (runId) => {
    if (get().live?.runId === runId) return
    get().live?.abort()
    let runbookId = get().live?.runbookId ?? ''
    try {
      runbookId = (await api.getRun(runId)).runbookId
    } catch {
      /* the stream carries the truth */
    }
    const live: LiveRun = {
      runbookId,
      runId,
      status: 'running',
      steps: [],
      log: [],
      abort: () => {},
    }
    live.abort = openRunStream('runbook', runId, runStreamHandlers(set, runbookId))
    set({ live })
  },

  cancelLiveRun: async () => {
    const rid = get().live?.runId
    if (rid == null) {
      get().live?.abort()
      return
    }
    try {
      await apiCancelRun('runbook', rid)
      // leave the stream open — it will emit run-end and settle the view
    } catch (e) {
      reportError(e, SRC)
    }
  },

  clearLive: () => {
    get().live?.abort()
    set({ live: null })
  },
}))

type Set = (
  partial:
    | Partial<RunbookStore>
    | ((s: RunbookStore) => Partial<RunbookStore>),
) => void

/**
 * SSE handlers that fold run events into `live`. Shared by startRun (fresh run)
 * and attachRun (re-attach to a background run via /runs/runbook/{id}/stream —
 * the replay rebuilds the step list, then live events continue).
 */
function runStreamHandlers(set: Set, runbookId: string) {
  return {
    onEvent: (name: string, data: unknown) => {
      const d = data as Record<string, unknown>
      set((s) => {
        if (!s.live) return s
        // A blank runbookId (attach couldn't look it up) matches anything.
        if (runbookId && s.live.runbookId && s.live.runbookId !== runbookId) return s
        const next = { ...s.live, steps: [...s.live.steps], log: [...s.live.log] }
        switch (name) {
          case 'run-start':
            next.runId = (d.runId as number) ?? next.runId
            if (next.status === 'starting') next.status = 'running'
            break
          case 'approval-required':
            next.runId = (d.runId as number) ?? next.runId
            next.status = 'awaiting_approval'
            break
          case 'approval-granted':
            next.status = 'running'
            break
          case 'step-start':
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
          case 'run-end': {
            const st = d.dryRun ? 'ok' : ((d.status as string) ?? 'ok')
            next.status = st === 'cancelled' ? 'failed' : (st as LiveRun['status'])
            if (st === 'cancelled' && d.reason) next.error = String(d.reason)
            break
          }
          case 'preview':
            break
          case 'error': {
            const ae = classify({ error: d.error, code: d.code, hint: d.hint }, SRC)
            next.status = 'error'
            next.error = ae.detail || ae.title
            next.errorObj = ae
            break
          }
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
    onError: (rawErr: Error) => {
      const ae = classify(rawErr, SRC)
      set((s) =>
        s.live
          ? { live: { ...s.live, status: 'error', error: ae.detail || ae.title, errorObj: ae } }
          : s,
      )
    },
  }
}
