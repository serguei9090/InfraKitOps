/**
 * MCP server registry — thin cache over the backend (A4a). Not persisted.
 * See AI_MCP_PLAN.md §6.
 */
import { create } from 'zustand'
import * as api from '@/adapters/backend/mcpClient'
import { reportError } from '@/stores/errorStore'
import type { McpServer, McpServerStatus } from '@/core/mcp/mcpModel'

const SRC = 'AI Hub'

interface McpStore {
  servers: McpServer[]
  statuses: Record<string, McpServerStatus>
  loaded: boolean

  refresh: () => Promise<void>
  putServer: (s: Partial<McpServer>) => Promise<string | null>
  removeServer: (id: string) => Promise<void>
}

export const useMcpStore = create<McpStore>((set, get) => ({
  servers: [],
  statuses: {},
  loaded: false,

  refresh: async () => {
    try {
      const { servers, statuses } = await api.listServers()
      set({ servers, statuses, loaded: true })
    } catch (e) {
      set({ loaded: true })
      reportError(e, SRC)
    }
  },

  putServer: async (s) => {
    try {
      const id = await api.putServer(s)
      await get().refresh()
      return id
    } catch (e) {
      reportError(e, SRC)
      return null
    }
  },

  removeServer: async (id) => {
    try {
      await api.deleteServer(id)
      await get().refresh()
    } catch (e) {
      reportError(e, SRC)
    }
  },
}))
