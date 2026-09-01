/**
 * Shared error queue — `report()` classifies anything thrown / received and
 * enqueues it for the <ErrorToaster/>. Modules call this on mutation failures;
 * reads / probes stay silent (the BackendUnavailable gate covers "no backend").
 * Not persisted. See ERROR_HANDLING_PLAN.md §5.2.
 */
import { create } from 'zustand'
import { classify, isAborted, type AppError } from '@/core/errors/appError'

export interface SurfacedError extends AppError {
  id: string
  at: number
  /** E3a — a re-runnable action; the toast shows a Retry button for it. */
  retry?: () => unknown
}

export interface ReportOpts {
  /** Show a Retry button that re-runs this. Only shown when the code is retryable. */
  retry?: () => unknown
}

interface ErrorStore {
  errors: SurfacedError[]
  /** E3b — every reported error, newest last, capped. Not touched by dismiss/clear. */
  history: SurfacedError[]
  /** timestamp the history drawer was last opened — unseen = `at` after this */
  historySeenAt: number
  /** Classify `raw` and enqueue it. No-op for aborted operations. */
  report: (raw: unknown, source?: string, opts?: ReportOpts) => AppError | null
  dismiss: (id: string) => void
  clear: () => void
  markHistorySeen: () => void
  clearHistory: () => void
}

const DEDUP_MS = 4000
const HISTORY_CAP = 50

function newId(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export const useErrorStore = create<ErrorStore>((set, get) => ({
  errors: [],
  history: [],
  historySeenAt: Date.now(),

  report: (raw, source, opts) => {
    if (isAborted(raw)) return null
    const err = classify(raw, source)
    const now = Date.now()
    const dup = get().errors.find(
      (e) => e.code === err.code && e.detail === err.detail && now - e.at < DEDUP_MS,
    )
    if (dup) return err
    const retry = err.retryable ? opts?.retry : undefined
    const entry: SurfacedError = { ...err, id: newId(), at: now, retry }
    set((s) => ({
      errors: [...s.errors, entry].slice(-8),
      history: [...s.history, entry].slice(-HISTORY_CAP),
    }))
    return err
  },

  dismiss: (id) => set((s) => ({ errors: s.errors.filter((e) => e.id !== id) })),
  clear: () => set({ errors: [] }),
  markHistorySeen: () => set({ historySeenAt: Date.now() }),
  clearHistory: () => set({ history: [], historySeenAt: Date.now() }),
}))

/** Convenience for non-hook call sites (e.g. inside a Zustand action). */
export const reportError = (raw: unknown, source?: string, opts?: ReportOpts) =>
  useErrorStore.getState().report(raw, source, opts)
