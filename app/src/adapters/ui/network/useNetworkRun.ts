import { useCallback, useRef, useState } from 'react'
import { saveRun } from '@/adapters/backend/historyClient'
import { BackendUnavailableError } from '@/adapters/backend/backendClient'
import type { RunEnvelope } from '@/core/network/history'

type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; envelope: RunEnvelope; savedId: number | null }
  | { status: 'error'; message: string }

interface UseNetworkRunOptions {
  /** Performs the request and returns the run envelope. */
  run: (signal: AbortSignal) => Promise<RunEnvelope>
  /** Auto-save the run to history on success (respects the module setting). Default true. */
  save?: boolean
}

/**
 * Shared run lifecycle for one-shot Network Toolkit tools: tracks
 * idle/running/done/error, exposes start/stop with abort, and auto-saves the
 * envelope to history. Streaming tools (N2) get their own hook.
 */
export function useNetworkRun<TResult = unknown>({ run, save = true }: UseNetworkRunOptions) {
  const [state, setState] = useState<RunState>({ status: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  const start = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState({ status: 'running' })
    try {
      const envelope = await run(controller.signal)
      if (controller.signal.aborted) return
      const savedId = save ? await saveRun(envelope) : null
      setState({ status: 'done', envelope, savedId })
    } catch (e) {
      if (controller.signal.aborted) return
      const message =
        e instanceof BackendUnavailableError
          ? 'The network backend is not connected.'
          : e instanceof Error
            ? e.message
            : String(e)
      setState({ status: 'error', message })
    }
  }, [run, save])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setState({ status: 'idle' })
  }, [])

  const envelope = state.status === 'done' ? state.envelope : undefined
  return {
    status: state.status,
    running: state.status === 'running',
    error: state.status === 'error' ? state.message : null,
    envelope,
    result: envelope?.result as TResult | undefined,
    savedId: state.status === 'done' ? state.savedId : null,
    start,
    stop,
  }
}
