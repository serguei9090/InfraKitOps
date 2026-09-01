/**
 * MCP server registry — thin cache over the backend (A4a). Not persisted.
 * See AI_MCP_PLAN.md §6.
 */
import { create } from 'zustand'
import * as api from '@/adapters/backend/mcpClient'
import { reportError } from '@/stores/errorStore'
import type { McpServer } from '@/core/mcp/mcpModel'

const SRC = 'AI Hub'

interface McpStore {
  servers: McpServer[]
  loaded: boolean

  refresh: () => Promise<void>
  putServer: (s: Partial<McpServer>) => Promise<string | null>
  removeServer: (id: string) => Promise<void>
}

export const useMcpStore = create<McpStore>((set, get) => ({
  servers: [],
  loaded: false,

  refresh: async () => {
    try {
      set({ servers: await api.listServers(), loaded: true })
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
