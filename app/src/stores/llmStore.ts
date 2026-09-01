/**
 * AI module — connection registry + playground state. Backend-side; this store
 * is a thin cache + the live chat buffer. Not persisted (last picks live in
 * localStorage inside the components). See AI_MODULE_PLAN.md §7.
 */
import { create } from 'zustand'
import * as api from '@/adapters/backend/llmClient'
import { reportError } from '@/stores/errorStore'
import type { ChatMessage, LlmConnection, LlmModel, LlmTask, TokenUsage } from '@/core/llm/llmModel'

const SRC = 'AI Hub'

export type Section = 'playground' | 'connections' | 'tasks'

export interface ChatTurn extends ChatMessage {
  /** streaming = still receiving; done/error = final */
  state?: 'streaming' | 'done' | 'error'
  usage?: TokenUsage
  error?: string
}

interface LiveChat {
  connId: string
  model: string
  turns: ChatTurn[]
  abort: () => void
  busy: boolean
}

interface LlmStore {
  section: Section
  connections: LlmConnection[]
  models: Record<string, LlmModel[]> // connId -> models
  tasks: LlmTask[]
  settings: Record<string, string>
  loaded: boolean
  error: string | null
  chat: LiveChat | null

  setSection: (s: Section) => void
  refresh: () => Promise<void>
  putConnection: (c: Partial<LlmConnection>) => Promise<LlmConnection | null>
  removeConnection: (id: string) => Promise<void>
  loadModels: (connId: string, force?: boolean) => Promise<LlmModel[]>
  refreshTasks: () => Promise<void>
  putTask: (t: Partial<LlmTask>) => Promise<void>
  resetTask: (id: string) => Promise<void>
  refreshSettings: () => Promise<void>
  putSettings: (patch: Record<string, string>) => Promise<void>

  startChat: (connId: string, model: string) => void
  sendMessage: (text: string) => void
  /** abort an in-flight reply, keeping whatever streamed so far */
  stopChat: () => void
  resetChat: () => void
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export const useLlmStore = create<LlmStore>((set, get) => ({
  section: 'playground',
  connections: [],
  models: {},
  tasks: [],
  settings: {},
  loaded: false,
  error: null,
  chat: null,

  setSection: (section) => set({ section }),

  refresh: async () => {
    try {
      set({ connections: await api.listConnections(), loaded: true, error: null })
    } catch (e) {
      set({ loaded: true, error: msg(e) })
    }
  },

  refreshTasks: async () => {
    try {
      set({ tasks: await api.listTasks() })
    } catch (e) {
      set({ error: msg(e) })
    }
  },

  putTask: async (t) => {
    try {
      await api.putTask(t)
      await get().refreshTasks()
    } catch (e) {
      reportError(e, SRC)
    }
  },

  resetTask: async (id) => {
    try {
      await api.deleteTask(id)
      await get().refreshTasks()
    } catch (e) {
      reportError(e, SRC)
    }
  },

  refreshSettings: async () => {
    try {
      set({ settings: await api.getLlmSettings() })
    } catch (e) {
      set({ error: msg(e) })
    }
  },

  putSettings: async (patch) => {
    try {
      set({ settings: await api.putLlmSettings(patch) })
    } catch (e) {
      reportError(e, SRC)
    }
  },

  putConnection: async (c) => {
    try {
      const saved = await api.putConnection(c)
      await get().refresh()
      return saved
    } catch (e) {
      reportError(e, SRC)
      return null
    }
  },

  removeConnection: async (id) => {
    try {
      await api.deleteConnection(id)
      set((s) => {
        const models = { ...s.models }
        delete models[id]
        return { models }
      })
      await get().refresh()
    } catch (e) {
      reportError(e, SRC)
    }
  },

  loadModels: async (connId, force = false) => {
    try {
      const models = await api.listModels(connId, force)
      set((s) => ({ models: { ...s.models, [connId]: models } }))
      return models
    } catch (e) {
      set({ error: msg(e) })
      return []
    }
  },

  startChat: (connId, model) => {
    get().chat?.abort()
    set({ chat: { connId, model, turns: [], abort: () => {}, busy: false } })
  },

  sendMessage: (text) => {
    const chat = get().chat
    if (!chat || chat.busy || !text.trim()) return

    const history: ChatMessage[] = chat.turns
      .filter((t) => t.state !== 'error')
      .map((t) => ({ role: t.role, content: t.content }))
    const outgoing: ChatMessage[] = [...history, { role: 'user', content: text }]

    set({
      chat: {
        ...chat,
        busy: true,
        turns: [
          ...chat.turns,
          { role: 'user', content: text, state: 'done' },
          { role: 'assistant', content: '', state: 'streaming' },
        ],
      },
    })

    const abort = api.openChatStream(
      { connId: chat.connId, model: chat.model, messages: outgoing },
      {
        onEvent: (name, data) => {
          const d = data as Record<string, unknown>
          set((s) => {
            if (!s.chat) return s
            const turns = [...s.chat.turns]
            const last = turns.length - 1
            if (last < 0) return s
            const cur = { ...turns[last] }
            let done = false
            if (name === 'delta') cur.content += (d.text as string) ?? ''
            else if (name === 'end') {
              cur.state = 'done'
              const u = d.usage as TokenUsage | undefined
              if (u) cur.usage = u
              done = true
            } else if (name === 'error') {
              cur.state = 'error'
              cur.error = (d.error as string) ?? 'chat failed'
              done = true
            }
            turns[last] = cur
            // Stay busy through the whole stream (incl. the gap before the
            // first delta) so the Stop button is available — only `end`/`error`
            // ends it.
            return { chat: { ...s.chat, turns, busy: !done } }
          })
        },
        onClose: () => set((s) => (s.chat ? { chat: { ...s.chat, busy: false } } : s)),
        onError: (err) =>
          set((s) => {
            if (!s.chat) return s
            const turns = [...s.chat.turns]
            const last = turns.length - 1
            if (last >= 0) turns[last] = { ...turns[last], state: 'error', error: err.message }
            return { chat: { ...s.chat, turns, busy: false } }
          }),
      },
    )
    set((s) => (s.chat ? { chat: { ...s.chat, abort } } : s))
  },

  stopChat: () => {
    const c = get().chat
    if (!c || !c.busy) return
    c.abort()
    set((s) => {
      if (!s.chat) return s
      const turns = [...s.chat.turns]
      const last = turns.length - 1
      if (last >= 0 && turns[last].state === 'streaming') {
        turns[last] = { ...turns[last], state: 'done' }
      }
      return { chat: { ...s.chat, turns, busy: false } }
    })
  },

  resetChat: () => {
    get().chat?.abort()
    const c = get().chat
    if (c) set({ chat: { ...c, turns: [], busy: false } })
  },
}))
