/**
 * AI module — connection registry + playground state. Backend-side; this store
 * is a thin cache + the live chat buffer. Not persisted (last picks live in
 * localStorage inside the components). See AI_MODULE_PLAN.md §7.
 */
import { create } from 'zustand'
import * as api from '@/adapters/backend/llmClient'
import { reportError } from '@/stores/errorStore'
import type {
  ChatMessage,
  ChatToolStep,
  LlmConnection,
  LlmConversation,
  LlmModel,
  LlmTask,
  StoredMessage,
  TokenUsage,
} from '@/core/llm/llmModel'

const SRC = 'AI Hub'

const AUTOSAVE_KEY = 'infrakit:llm-autosave'
const autoSaveDefault = () => {
  try {
    return localStorage.getItem(AUTOSAVE_KEY) === '1'
  } catch {
    return false
  }
}

export type Section = 'playground' | 'connections' | 'tasks' | 'mcp'

export interface ChatTurn extends ChatMessage {
  /** streaming = still receiving; done/error = final */
  state?: 'streaming' | 'done' | 'error'
  usage?: TokenUsage
  error?: string
  /** tool calls made during this assistant turn (A4b) */
  steps?: ChatToolStep[]
}

interface LiveChat {
  connId: string
  model: string
  turns: ChatTurn[]
  abort: () => void
  busy: boolean
  /** "" = off, "all" or a comma list of MCP server ids */
  tools: string
  /** set once this chat is saved (A3b) — further saves update the same row */
  savedId?: string
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

  // A3b — opt-in conversation history
  conversations: LlmConversation[]
  autoSave: boolean

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
  /** toggle MCP tools for the live chat ("" = off, "all" = every enabled server) */
  setChatTools: (tools: string) => void
  sendMessage: (text: string) => void
  /** A4c — approve/deny a paused tool call by its approvalId */
  resumeToolCall: (approvalId: string, approved: boolean) => void
  /** abort an in-flight reply, keeping whatever streamed so far */
  stopChat: () => void
  resetChat: () => void

  // A3b
  refreshConversations: () => Promise<void>
  setAutoSave: (on: boolean) => void
  /** save the live chat (create or update its row); returns the id */
  saveChat: (title?: string) => Promise<string | null>
  loadConversation: (id: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  patchConversation: (id: string, patch: { title?: string; pinned?: boolean }) => Promise<void>
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
  conversations: [],
  autoSave: autoSaveDefault(),

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
    const prevTools = get().chat?.tools ?? ''
    get().chat?.abort()
    set({ chat: { connId, model, turns: [], abort: () => {}, busy: false, tools: prevTools } })
  },

  setChatTools: (tools) => {
    const c = get().chat
    if (c) set({ chat: { ...c, tools } })
  },

  resumeToolCall: (approvalId, approved) => {
    // optimistic: drop the pending flag so the buttons disappear at once
    set((s) => {
      if (!s.chat) return s
      const turns = s.chat.turns.map((t) =>
        t.steps?.some((st) => st.approvalId === approvalId)
          ? { ...t, steps: t.steps.map((st) => (st.approvalId === approvalId ? { ...st, approvalId: undefined } : st)) }
          : t,
      )
      return { chat: { ...s.chat, turns } }
    })
    void api.resumeTool(approvalId, approved).catch((e) => reportError(e, SRC))
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
      { connId: chat.connId, model: chat.model, messages: outgoing, tools: chat.tools || undefined },
      {
        onEvent: (name, data) => {
          const d = data as Record<string, unknown>
          if (name === 'end' && get().autoSave) {
            // fire after the state update below has landed
            queueMicrotask(() => void get().saveChat())
          }
          set((s) => {
            if (!s.chat) return s
            const turns = [...s.chat.turns]
            const last = turns.length - 1
            if (last < 0) return s
            const cur = { ...turns[last], steps: turns[last].steps ? [...turns[last].steps!] : undefined }
            let done = false
            if (name === 'delta') cur.content += (d.text as string) ?? ''
            else if (name === 'tool-call') {
              cur.steps = [
                ...(cur.steps ?? []),
                { id: String(d.id), name: String(d.name), args: d.args as Record<string, unknown> | undefined },
              ]
            } else if (name === 'tool-approval') {
              cur.steps = (cur.steps ?? []).map((st) =>
                st.id === String(d.id) ? { ...st, approvalId: String(d.approvalId) } : st,
              )
            } else if (name === 'tool-result') {
              cur.steps = (cur.steps ?? []).map((st) =>
                st.id === String(d.id)
                  ? {
                      ...st,
                      done: true,
                      ok: d.ok !== false,
                      denied: d.denied === true,
                      approvalId: undefined,
                      result: (d.text as string) ?? '',
                    }
                  : st,
              )
            } else if (name === 'end') {
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
    if (c) set({ chat: { ...c, turns: [], busy: false, savedId: undefined } })
  },

  // --- A3b conversation history ----------------------------------

  refreshConversations: async () => {
    try {
      set({ conversations: await api.listConversations() })
    } catch (e) {
      reportError(e, SRC)
    }
  },

  setAutoSave: (on) => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, on ? '1' : '0')
    } catch {
      /* ignore */
    }
    set({ autoSave: on })
  },

  saveChat: async (title) => {
    const c = get().chat
    if (!c || c.turns.length === 0) return null
    const messages: StoredMessage[] = c.turns
      .filter((t) => t.state !== 'error')
      .map((t) => ({
        role: t.role,
        content: t.content,
        steps: t.steps,
        promptTokens: t.usage?.promptTokens,
        completionTokens: t.usage?.completionTokens,
      }))
    const firstUser = c.turns.find((t) => t.role === 'user')?.content ?? 'Chat'
    try {
      const id = await api.saveConversation({
        id: c.savedId,
        title: title || firstUser.slice(0, 60),
        connId: c.connId,
        model: c.model,
        messages,
      })
      set((s) => (s.chat ? { chat: { ...s.chat, savedId: id } } : s))
      await get().refreshConversations()
      return id
    } catch (e) {
      reportError(e, SRC)
      return null
    }
  },

  loadConversation: async (id) => {
    try {
      const { conversation, messages } = await api.getConversation(id)
      get().chat?.abort()
      set({
        chat: {
          connId: conversation.connId ?? '',
          model: conversation.model ?? '',
          tools: '',
          abort: () => {},
          busy: false,
          savedId: conversation.id,
          turns: messages.map((m) => ({
            role: m.role,
            content: m.content,
            state: 'done',
            steps: m.steps,
            usage:
              m.promptTokens || m.completionTokens
                ? { promptTokens: m.promptTokens ?? 0, completionTokens: m.completionTokens ?? 0 }
                : undefined,
          })),
        },
      })
    } catch (e) {
      reportError(e, SRC)
    }
  },

  deleteConversation: async (id) => {
    try {
      await api.deleteConversation(id)
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== id),
        chat: s.chat?.savedId === id ? { ...s.chat, savedId: undefined } : s.chat,
      }))
    } catch (e) {
      reportError(e, SRC)
    }
  },

  patchConversation: async (id, patch) => {
    try {
      await api.patchConversation(id, patch)
      await get().refreshConversations()
    } catch (e) {
      reportError(e, SRC)
    }
  },
}))
