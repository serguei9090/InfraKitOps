/**
 * Background-runs client (BACKGROUND_RUNS_PLAN.md). A run is a server-side
 * object: start it with a POST that returns `{runId}`, watch it with a
 * replay+tail SSE stream, cancel it explicitly. Closing the stream does not
 * cancel the run.
 */
import { backendGet, backendRequest } from './backendClient'
import { openStream, type StreamHandlers } from './sseClient'

export type RunModule = 'ansible' | 'runbook'

export interface ActiveRun {
  module: RunModule
  id: number
  owner: string
  target: string
  status: string
  startedAt: number
}

/** The caller's in-flight runs across every module, newest first. */
export const listActiveRuns = () =>
  backendGet<{ runs: ActiveRun[] | null }>('/runs/active').then((r) => r.runs ?? [])

/** Replay the run's persisted event log, then tail live events. */
export function openRunStream(module: RunModule, id: number, handlers: StreamHandlers): () => void {
  return openStream(`/runs/${module}/${id}/stream`, {}, handlers)
}

/** Ask the backend to cancel an in-flight run. */
export const cancelRun = (module: RunModule, id: number) =>
  backendRequest<{ status: string }>('POST', `/runs/${module}/${id}/cancel`)
