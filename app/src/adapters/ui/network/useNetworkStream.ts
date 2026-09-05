import { useCallback, useEffect, useRef, useState } from 'react'
import { openStream } from '@/adapters/backend/sseClient'
import { saveRun } from '@/adapters/backend/historyClient'
import type { RunEnvelope } from '@/core/network/history'

type StreamStatus = 'idle' | 'streaming' | 'done' | 'error'

interface UseNetworkStreamOptions {
  /** SSE path under `/api/v1`, e.g. `/port-scanner/stream`. */
  path: string
  /** Reset the tool's own accumulated state before a new stream starts. */
  onStart?: () => void
  /** Handle each streamed event ('done' and 'error' are consumed by the hook). */
  onEvent: (name: string, data: unknown) => void
  /** Auto-save the final envelope to history. Default true. */
  save?: boolean
}

/**
 * Run lifecycle for streaming Network Toolkit tools (ping monitor, traceroute,
 * scans). The backend emits incremental events plus a final `done` event
 * carrying the full `RunEnvelope`; the hook auto-saves that to history.
 */
export function useNetworkStream({ path, onStart, onEvent, save = true }: UseNetworkStreamOptions) {
  const [status, setStatus] = useState<StreamStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [envelope, setEnvelope] = useState<RunEnvelope | null>(null)
  const [completions, setCompletions] = useState(0)
  const abortRef = useRef<(() => void) | null>(null)

  const start = useCallback(
    (params: Record<string, string>) => {
      abortRef.current?.()
      onStart?.()
      setError(null)
      setEnvelope(null)
      setStatus('streaming')

      abortRef.current = openStream(path, params, {
        onEvent: (name, data) => {
          if (name === 'done') {
            const env = data as RunEnvelope
            setEnvelope(env)
            setStatus('done')
            setCompletions((n) => n + 1)
            if (save) void saveRun(env)
            return
          }
          if (name === 'error') {
            const msg = typeof data === 'object' && data && 'error' in data ? String((data as { error: unknown }).error) : 'stream error'
            setError(msg)
            setStatus('error')
            return
          }
          onEvent(name, data)
        },
        onClose: () => setStatus((s) => (s === 'streaming' ? 'done' : s)),
        onError: (e) => {
          setError(e.message)
          setStatus('error')
        },
      })
    },
    [path, onStart, onEvent, save],
  )

  const stop = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setStatus((s) => (s === 'streaming' ? 'idle' : s))
  }, [])

  // Abort any in-flight stream when the tool screen unmounts (navigating away
  // without pressing Stop). A leaked SSE connection stays open and, a few
  // navigations later, exhausts the browser's per-host connection limit —
  // every subsequent backend call, /health included, then stalls.
  useEffect(() => {
    return () => {
      abortRef.current?.()
      abortRef.current = null
    }
  }, [])

  return {
    status,
    streaming: status === 'streaming',
    error,
    envelope,
    completions,
    start,
    stop,
  }
}
