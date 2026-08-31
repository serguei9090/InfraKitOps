import { useCallback, useEffect, useRef, useState } from 'react'
import { openTaskStream } from '@/adapters/backend/llmClient'
import type { ChatMessage, TokenUsage } from '@/core/llm/llmModel'

export interface LlmRunInput {
  connId: string
  model?: string
  context?: Record<string, string>
  input?: string
  history?: ChatMessage[]
}

export interface LlmRunState {
  running: boolean
  text: string
  parsed?: unknown
  usage?: TokenUsage
  error?: string
}

/**
 * The consumer API — a module calls `useLlm(taskId)` and `run(...)` with its
 * grounding context. The task's system prompt + context + input are assembled
 * server-side; this hook just streams the result. See AI_MODULE_PLAN.md §7.1.
 */
export function useLlm(taskId: string) {
  const [state, setState] = useState<LlmRunState>({ running: false, text: '' })
  const abortRef = useRef<(() => void) | null>(null)

  const run = useCallback(
    (opts: LlmRunInput) => {
      abortRef.current?.()
      setState({ running: true, text: '' })
      abortRef.current = openTaskStream(
        { taskId, ...opts },
        {
          onEvent: (name, data) => {
            const d = data as Record<string, unknown>
            setState((s) => {
              switch (name) {
                case 'delta':
                  return { ...s, text: s.text + ((d.text as string) ?? '') }
                case 'parsed':
                  try {
                    return { ...s, parsed: JSON.parse(d.json as string) }
                  } catch {
                    return s
                  }
                case 'end':
                  return { ...s, running: false, usage: d.usage as TokenUsage | undefined }
                case 'error':
                  return { ...s, running: false, error: (d.error as string) ?? 'run failed' }
                default:
                  return s
              }
            })
          },
          onClose: () => setState((s) => ({ ...s, running: false })),
          onError: (e) => setState((s) => ({ ...s, running: false, error: e.message })),
        },
      )
    },
    [taskId],
  )

  const cancel = useCallback(() => {
    abortRef.current?.()
    setState((s) => ({ ...s, running: false }))
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.()
    setState({ running: false, text: '' })
  }, [])

  useEffect(() => () => abortRef.current?.(), [])

  return { ...state, run, cancel, reset }
}
