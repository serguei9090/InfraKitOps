/**
 * MCP client layer (A4). Backend-mandatory — every call throws
 * `BackendUnavailableError` with no backend. See AI_MCP_PLAN.md §5.
 */
import { backendGet, backendRequest } from './backendClient'
import type {
  McpPrompt,
  McpPromptResult,
  McpResource,
  McpResourceRead,
  McpResourceTemplate,
  McpServer,
  McpServerStatus,
  McpTestResult,
  McpTool,
} from '@/core/mcp/mcpModel'

const arr = <T,>(v: T[] | null | undefined): T[] => v ?? []

export const listServers = () =>
  backendGet<{ servers: McpServer[] | null; statuses: Record<string, McpServerStatus> | null }>(
    '/mcp/servers',
  ).then((r) => ({ servers: arr(r.servers), statuses: r.statuses ?? {} }))

export const putServer = (s: Partial<McpServer>) =>
  backendRequest<{ id: string }>(s.id ? 'PUT' : 'POST', s.id ? `/mcp/servers/${s.id}` : '/mcp/servers', s).then(
    (r) => r.id,
  )

export const deleteServer = (id: string) => backendRequest<unknown>('DELETE', `/mcp/servers/${id}`)

export const testServer = (id: string) =>
  backendRequest<McpTestResult>('POST', `/mcp/servers/${id}/test`)

export const listTools = () =>
  backendGet<{ tools: McpTool[] | null }>('/mcp/tools').then((r) => arr(r.tools))

// --- resources & prompts (A4f) ---

export const listResources = () =>
  backendGet<{ resources: McpResource[] | null; templates: McpResourceTemplate[] | null }>(
    '/mcp/resources',
  ).then((r) => ({ resources: arr(r.resources), templates: arr(r.templates) }))

export const readResource = (server: string, uri: string) =>
  backendRequest<McpResourceRead>('POST', '/mcp/resources/read', { server, uri }).then((r) => ({
    contents: arr(r.contents),
    truncated: r.truncated,
  }))

export const listPrompts = () =>
  backendGet<{ prompts: McpPrompt[] | null }>('/mcp/prompts').then((r) => arr(r.prompts))

export const getPrompt = (server: string, name: string, args: Record<string, string>) =>
  backendRequest<McpPromptResult>('POST', '/mcp/prompts/get', { server, name, args }).then((r) => ({
    description: r.description,
    messages: arr(r.messages),
  }))
