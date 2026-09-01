/**
 * MCP client layer (A4). Backend-mandatory — every call throws
 * `BackendUnavailableError` with no backend. See AI_MCP_PLAN.md §5.
 */
import { backendGet, backendRequest } from './backendClient'
import type { McpServer, McpTestResult, McpTool } from '@/core/mcp/mcpModel'

const arr = <T,>(v: T[] | null | undefined): T[] => v ?? []

export const listServers = () =>
  backendGet<{ servers: McpServer[] | null }>('/mcp/servers').then((r) => arr(r.servers))

export const putServer = (s: Partial<McpServer>) =>
  backendRequest<{ id: string }>(s.id ? 'PUT' : 'POST', s.id ? `/mcp/servers/${s.id}` : '/mcp/servers', s).then(
    (r) => r.id,
  )

export const deleteServer = (id: string) => backendRequest<unknown>('DELETE', `/mcp/servers/${id}`)

export const testServer = (id: string) =>
  backendRequest<McpTestResult>('POST', `/mcp/servers/${id}/test`)

export const listTools = () =>
  backendGet<{ tools: McpTool[] | null }>('/mcp/tools').then((r) => arr(r.tools))
