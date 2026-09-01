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

/** Last-known health of a server (A4e-3, +A4f counts). */
export interface McpServerStatus {
  connected: boolean
  toolCount: number
  resourceCount?: number
  promptCount?: number
  connectedAt?: number
  lastError?: string
  lastErrorAt?: number
}

// --- resources & prompts (A4f) — mirrors backend/internal/mcp/spec.go ---

export interface McpResource {
  server: string
  serverName: string
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
  size?: number
}

export interface McpResourceTemplate {
  server: string
  serverName: string
  uriTemplate: string
  name: string
  title?: string
  description?: string
  mimeType?: string
}

export interface McpResourceContent {
  uri: string
  mimeType?: string
  text: string
}

export interface McpResourceRead {
  contents: McpResourceContent[]
  truncated?: boolean
}

export interface McpPromptArg {
  name: string
  description?: string
  required?: boolean
}

export interface McpPrompt {
  server: string
  serverName: string
  name: string
  title?: string
  description?: string
  arguments?: McpPromptArg[]
}

export interface McpPromptMessage {
  role: string
  text: string
}

export interface McpPromptResult {
  description?: string
  messages: McpPromptMessage[]
}

/** A resource the user attached to a chat as context (client-only). */
export interface McpContextBlock {
  uri: string
  name: string
  text: string
  truncated?: boolean
}

/** `text/*`, plus common structured text types — what we can attach in v1. */
export function isTextResource(mime?: string): boolean {
  if (!mime) return true // servers often omit it for text
  return (
    mime.startsWith('text/') ||
    /^application\/(json|xml|yaml|x-yaml|toml|javascript|x-ndjson)$/.test(mime) ||
    mime.endsWith('+json') ||
    mime.endsWith('+xml')
  )
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
