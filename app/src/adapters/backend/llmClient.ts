/**
 * AI module — backend client. All calls go through the shared `/api/v1`
 * helpers; the chat stream uses the SSE client. Backend-mandatory
 * (AI_MODULE_PLAN.md §2), so every function throws `BackendUnavailableError`
 * when no backend is connected.
 */
import { backendGet, backendRequest } from './backendClient'
import { openStream, type StreamHandlers } from './sseClient'
import type {
  ChatMessage,
  LlmConnection,
  LlmConversation,
  LlmModel,
  LlmTask,
  StoredMessage,
  UsageGroup,
} from '@/core/llm/llmModel'

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
  code?: string
  hint?: string
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
  /** "all" or a comma list of MCP server ids — offers those tools to the model */
  tools?: string
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
  if (opts.tools) params.tools = opts.tools
  return openStream('/llm/chat/stream', params, handlers)
}

/** A4c — deliver the user's decision for a paused (non-read-only) tool call. */
export const resumeTool = (approvalId: string, approved: boolean) =>
  backendRequest<{ ok: boolean }>('POST', `/llm/tool/${approvalId}/resume`, { approved })

// --- conversation history (A3b) ---------------------------------

export const listConversations = () =>
  backendGet<{ conversations: LlmConversation[] | null }>('/llm/conversations').then((r) => arr(r.conversations))

export const getConversation = (id: string) =>
  backendGet<{ conversation: LlmConversation; messages: StoredMessage[] | null }>(`/llm/conversations/${id}`).then(
    (r) => ({ conversation: r.conversation, messages: arr(r.messages) }),
  )

export const saveConversation = (body: {
  id?: string
  title: string
  connId?: string
  model?: string
  taskId?: string
  pinned?: boolean
  messages: StoredMessage[]
}) => backendRequest<{ id: string }>('POST', '/llm/conversations', body).then((r) => r.id)

export const patchConversation = (id: string, patch: { title?: string; pinned?: boolean }) =>
  backendRequest<unknown>('PATCH', `/llm/conversations/${id}`, patch)

export const deleteConversation = (id: string) =>
  backendRequest<unknown>('DELETE', `/llm/conversations/${id}`)

// --- token usage (A3c) -----------------------------------------

export const getUsage = (days: number, groupBy: 'model' | 'day' | 'task') =>
  backendGet<{ days: number; groups: UsageGroup[] | null }>(
    `/llm/usage?days=${days}&groupBy=${groupBy}`,
  ).then((r) => arr(r.groups))

// --- tasks -------------------------------------------------------

export const listTasks = () =>
  backendGet<{ tasks: LlmTask[] | null }>('/llm/tasks').then((r) => arr(r.tasks))

export const putTask = (t: Partial<LlmTask>) =>
  backendRequest<{ task: LlmTask }>(
    t.id ? 'PUT' : 'POST',
    t.id ? `/llm/tasks/${t.id}` : '/llm/tasks',
    t,
  ).then((r) => r.task)

export const deleteTask = (id: string) => backendRequest<unknown>('DELETE', `/llm/tasks/${id}`)

// --- settings ---------------------------------------------------

export const getLlmSettings = () =>
  backendGet<{ settings: Record<string, string> }>('/llm/settings').then((r) => r.settings ?? {})

export const putLlmSettings = (patch: Record<string, string>) =>
  backendRequest<{ settings: Record<string, string> }>('PUT', '/llm/settings', patch).then((r) => r.settings ?? {})

export interface TaskRunOpts {
  taskId: string
  connId: string
  model?: string
  context?: Record<string, string>
  input?: string
  history?: ChatMessage[]
  /** "all" or a comma list of MCP server ids */
  tools?: string
}

/** Open a grounded task run. Returns an abort function. */
export function openTaskStream(opts: TaskRunOpts, handlers: StreamHandlers): () => void {
  const params: Record<string, string> = { connId: opts.connId }
  if (opts.model) params.model = opts.model
  if (opts.input) params.input = opts.input
  if (opts.context) params.context = JSON.stringify(opts.context)
  if (opts.history?.length) params.history = JSON.stringify(opts.history)
  if (opts.tools) params.tools = opts.tools
  return openStream(`/llm/tasks/${opts.taskId}/run/stream`, params, handlers)
}
