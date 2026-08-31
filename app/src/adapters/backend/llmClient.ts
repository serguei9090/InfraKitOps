/**
 * AI module — backend client. All calls go through the shared `/api/v1`
 * helpers; the chat stream uses the SSE client. Backend-mandatory
 * (AI_MODULE_PLAN.md §2), so every function throws `BackendUnavailableError`
 * when no backend is connected.
 */
import { backendGet, backendRequest } from './backendClient'
import { openStream, type StreamHandlers } from './sseClient'
import type { ChatMessage, LlmConnection, LlmModel } from '@/core/llm/llmModel'

const arr = <T,>(v: T[] | null | undefined): T[] => v ?? []

// --- connections ---------------------------------------------------

export const listConnections = () =>
  backendGet<{ connections: LlmConnection[] | null }>('/llm/connections').then((r) => arr(r.connections))

export const putConnection = (c: Partial<LlmConnection>) =>
  backendRequest<{ connection: LlmConnection }>(
    c.id ? 'PUT' : 'POST',
    c.id ? `/llm/connections/${c.id}` : '/llm/connections',
    c,
  ).then((r) => r.connection)

export const deleteConnection = (id: string) =>
  backendRequest<unknown>('DELETE', `/llm/connections/${id}`)

export interface ConnectionTestResult {
  ok: boolean
  models?: LlmModel[]
  error?: string
}
export const testConnection = (id: string) =>
  backendRequest<ConnectionTestResult>('POST', `/llm/connections/${id}/test`)

export const listModels = (id: string, force = false) =>
  backendGet<{ models: LlmModel[] | null }>(`/llm/connections/${id}/models${force ? '?force=1' : ''}`).then((r) =>
    arr(r.models),
  )

// --- chat --------------------------------------------------------

export interface ChatStreamOpts {
  connId: string
  model?: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}

/** Open the chat stream. Returns an abort function. */
export function openChatStream(opts: ChatStreamOpts, handlers: StreamHandlers): () => void {
  const params: Record<string, string> = {
    connId: opts.connId,
    messages: JSON.stringify(opts.messages),
  }
  if (opts.model) params.model = opts.model
  if (opts.temperature != null) params.temperature = String(opts.temperature)
  if (opts.maxTokens != null) params.maxTokens = String(opts.maxTokens)
  return openStream('/llm/chat/stream', params, handlers)
}
