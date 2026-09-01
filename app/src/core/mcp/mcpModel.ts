/**
 * MCP client model — framework-free (no React), same rule as the rest of
 * `src/core/**`. Mirrors `backend/internal/mcp/spec.go`. See AI_MCP_PLAN.md.
 */

export type McpTransport = 'stdio' | 'http'

export interface McpServer {
  id: string
  name: string
  transport: McpTransport
  /** stdio */
  command?: string
  args?: string[]
  /** stdio — values may contain {{secret:NAME}} */
  env?: Record<string, string>
  /** http */
  url?: string
  authSecretId?: string
  enabled: boolean
  /** raw tool names; empty = all */
  toolAllow?: string[]
  createdAt: number
}

export interface McpTool {
  server: string
  serverName: string
  name: string
  qualifiedName: string
  title?: string
  description?: string
  inputSchema?: unknown
  readOnly: boolean
}

export interface McpTestResult {
  ok: boolean
  tools?: McpTool[]
  error?: string
  code?: string
  hint?: string
}

export function emptyServer(transport: McpTransport = 'stdio'): McpServer {
  return {
    id: '',
    name: '',
    transport,
    command: '',
    args: [],
    env: {},
    url: '',
    enabled: true,
    createdAt: 0,
  }
}

export const TRANSPORT_LABEL: Record<McpTransport, string> = {
  stdio: 'Local process (stdio)',
  http: 'Remote (HTTP/SSE)',
}
