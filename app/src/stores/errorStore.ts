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
}

interface ErrorStore {
  errors: SurfacedError[]
  /** Classify `raw` and enqueue it. No-op for aborted operations. */
  report: (raw: unknown, source?: string) => AppError | null
  dismiss: (id: string) => void
  clear: () => void
}

const DEDUP_MS = 4000

function newId(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export const useErrorStore = create<ErrorStore>((set, get) => ({
  errors: [],

  report: (raw, source) => {
    if (isAborted(raw)) return null
    const err = classify(raw, source)
    const now = Date.now()
    const dup = get().errors.find(
      (e) => e.code === err.code && e.detail === err.detail && now - e.at < DEDUP_MS,
    )
    if (dup) return err
    set((s) => ({ errors: [...s.errors, { ...err, id: newId(), at: now }].slice(-8) }))
    return err
  },

  dismiss: (id) => set((s) => ({ errors: s.errors.filter((e) => e.id !== id) })),
  clear: () => set({ errors: [] }),
}))

/** Convenience for non-hook call sites (e.g. inside a Zustand action). */
export const reportError = (raw: unknown, source?: string) => useErrorStore.getState().report(raw, source)
