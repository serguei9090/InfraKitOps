import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Boxes,
  History,
  Loader2,
  MessageSquareText,
  Paperclip,
  Pin,
  RotateCcw,
  Save,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useLlmStore } from '@/stores/llmStore'
import { useMcpStore } from '@/stores/mcpStore'
import type { McpContextBlock } from '@/core/mcp/mcpModel'
import { ContextPickerDialog } from './ContextPickerDialog'
import { PromptPickerDialog } from './PromptPickerDialog'
import { ToolSteps } from './ToolSteps'
import { cn } from '@/lib/utils'

const LAST_CONN = 'infrakit:llm-playground-conn'
const LAST_MODEL = 'infrakit:llm-playground-model'

export function PlaygroundView() {
  const connections = useLlmStore((s) => s.connections)
  const models = useLlmStore((s) => s.models)
  const loadModels = useLlmStore((s) => s.loadModels)
  const chat = useLlmStore((s) => s.chat)
  const startChat = useLlmStore((s) => s.startChat)
  const sendMessage = useLlmStore((s) => s.sendMessage)
  const stopChat = useLlmStore((s) => s.stopChat)
  const resetChat = useLlmStore((s) => s.resetChat)
  const setChatTools = useLlmStore((s) => s.setChatTools)
  const setChatContext = useLlmStore((s) => s.setChatContext)
  const resumeToolCall = useLlmStore((s) => s.resumeToolCall)
  const conversations = useLlmStore((s) => s.conversations)
  const autoSave = useLlmStore((s) => s.autoSave)
  const setAutoSave = useLlmStore((s) => s.setAutoSave)
  const refreshConversations = useLlmStore((s) => s.refreshConversations)
  const saveChat = useLlmStore((s) => s.saveChat)
  const loadConversation = useLlmStore((s) => s.loadConversation)
  const deleteConversation = useLlmStore((s) => s.deleteConversation)
  const patchConversation = useLlmStore((s) => s.patchConversation)
  const mcpServers = useMcpStore((s) => s.servers)
  const refreshMcp = useMcpStore((s) => s.refresh)
  const mcpLoaded = useMcpStore((s) => s.loaded)

  const [connId, setConnId] = useState('')
  const [model, setModel] = useState('')
  const [draft, setDraft] = useState('')
  const [toolsOn, setToolsOn] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [pickCtx, setPickCtx] = useState(false)
  const [pickPrompt, setPickPrompt] = useState(false)
  const [attached, setAttached] = useState<McpContextBlock[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mcpLoaded) void refreshMcp()
  }, [mcpLoaded, refreshMcp])

  useEffect(() => {
    void refreshConversations()
  }, [refreshConversations])

  const enabledServers = mcpServers.filter((s) => s.enabled).length

  // restore last picks once connections load
  useEffect(() => {
    if (connections.length === 0) return
    const savedConn = safeGet(LAST_CONN)
    const pick = connections.find((c) => c.id === savedConn) ?? connections[0]
    setConnId((cur) => cur || pick.id)
  }, [connections])

  useEffect(() => {
    if (!connId) return
    safeSet(LAST_CONN, connId)
    void loadModels(connId)
    const conn = connections.find((c) => c.id === connId)
    setModel(safeGet(LAST_MODEL) || conn?.defaultModel || '')
  }, [connId, connections, loadModels])

  const connModels = useMemo(() => models[connId] ?? [], [models, connId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [chat?.turns])

  function ensureChat() {
    if (!chat || chat.connId !== connId || chat.model !== model) {
      startChat(connId, model)
    }
  }

  function send() {
    if (!connId || !model || !draft.trim()) return
    safeSet(LAST_MODEL, model)
    ensureChat() // zustand set is synchronous — the chat is in place after this
    setChatTools(toolsOn && enabledServers > 0 ? 'all' : '')
    setChatContext(attached)
    sendMessage(draft)
    setDraft('')
    setAttached([])
  }

  if (connections.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Add a connection first — see the <span className="mx-1 font-medium">Connections</span> tab.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {showHistory && (
        <aside className="flex w-56 shrink-0 flex-col border-r border-border/60 bg-card/40">
          <div className="flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground">
            Saved chats
            <button type="button" onClick={() => setShowHistory(false)} aria-label="Hide">
              <X className="size-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            {conversations.length === 0 ? (
              <p className="px-2 py-4 text-[11px] text-muted-foreground">
                None yet. Save a chat with the disk icon, or turn on auto-save.
              </p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs hover:bg-accent/40',
                    chat?.savedId === c.id && 'bg-primary/10',
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => void loadConversation(c.id)}
                    title={c.title}
                  >
                    <span className="block truncate">
                      {c.pinned && <Pin className="mr-1 inline size-3 text-primary" />}
                      {c.title}
                    </span>
                    {c.promptTokens + c.completionTokens > 0 && (
                      <span className="block text-[10px] text-muted-foreground">
                        {fmtTok(c.promptTokens + c.completionTokens)} tok
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Pin"
                    className="shrink-0 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                    onClick={() => void patchConversation(c.id, { pinned: !c.pinned })}
                  >
                    <Pin className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete"
                    className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                    onClick={() => void deleteConversation(c.id)}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))
            )}
          </div>
          <label className="flex items-center gap-1.5 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              className="size-3 accent-primary"
              checked={autoSave}
              onChange={(e) => setAutoSave(e.target.checked)}
            />
            Auto-save chats
          </label>
        </aside>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2">
        <Button
          size="xs"
          variant={showHistory ? 'default' : 'ghost'}
          onClick={() => setShowHistory((v) => !v)}
          aria-label="Saved chats"
        >
          <History className="size-3.5" />
        </Button>
        <Select value={connId} onValueChange={(v) => v && setConnId(v)}>
          <SelectTrigger size="sm" className="w-48">
            <SelectValue placeholder="connection">
              {(v) => connections.find((c) => c.id === v)?.name ?? 'connection'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {connections.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={model} onValueChange={(v) => v && setModel(v)}>
          <SelectTrigger size="sm" className="w-56">
            <SelectValue placeholder={connModels.length ? 'model' : 'no models — test the connection'} />
          </SelectTrigger>
          <SelectContent>
            {connModels.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="xs" variant="ghost" onClick={() => void loadModels(connId, true)}>
          <RotateCcw className="size-3.5" /> models
        </Button>
        <Button
          size="xs"
          variant={toolsOn ? 'default' : 'ghost'}
          disabled={enabledServers === 0}
          onClick={() => setToolsOn((v) => !v)}
          title={
            enabledServers === 0
              ? 'No enabled MCP servers — add one in the MCP tab'
              : `${enabledServers} MCP server${enabledServers === 1 ? '' : 's'}`
          }
        >
          <Boxes className="size-3.5" /> Tools{toolsOn ? ' on' : ''}
        </Button>
        <Button
          size="xs"
          variant={attached.length > 0 ? 'default' : 'ghost'}
          disabled={enabledServers === 0}
          onClick={() => setPickCtx(true)}
          title={
            enabledServers === 0
              ? 'No enabled MCP servers — add one in the MCP tab'
              : 'Attach an MCP resource as context'
          }
        >
          <Paperclip className="size-3.5" /> Context{attached.length > 0 ? ` (${attached.length})` : ''}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={enabledServers === 0}
          onClick={() => setPickPrompt(true)}
          title={
            enabledServers === 0
              ? 'No enabled MCP servers — add one in the MCP tab'
              : 'Insert a server-provided prompt'
          }
        >
          <MessageSquareText className="size-3.5" /> Prompts
        </Button>
        <div className="flex-1" />
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void saveChat()}
          disabled={!chat?.turns.length || chat.busy}
          title={chat?.savedId ? 'Update the saved copy' : 'Save this chat'}
        >
          <Save className="size-3.5" />
          {chat?.savedId ? 'Saved' : 'Save'}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => resetChat()} disabled={!chat?.turns.length}>
          Clear
        </Button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {(chat?.turns ?? []).map((t, i) => (
            <div
              key={i}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm',
                t.role === 'user' ? 'border-border/60 bg-card' : 'border-primary/20 bg-primary/5',
                t.state === 'error' && 'border-destructive/40 bg-destructive/5',
              )}
            >
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t.role}
                {t.state === 'streaming' && ' · …'}
                {t.usage && ` · ${t.usage.promptTokens}+${t.usage.completionTokens} tok`}
              </div>
              {t.steps && t.steps.length > 0 && (
                <ToolSteps
                  steps={t.steps}
                  className="mb-2"
                  onApprove={(id) => resumeToolCall(id, true)}
                  onDeny={(id) => resumeToolCall(id, false)}
                />
              )}
              {(t.content || t.error || !t.steps?.length) && (
                <pre className="whitespace-pre-wrap break-words font-sans">{t.content || (t.error ?? '')}</pre>
              )}
            </div>
          ))}
          {!chat?.turns.length && (
            <p className="py-16 text-center text-xs text-muted-foreground">
              Pick a model and send a message. Chats aren&rsquo;t saved unless you hit Save or turn on auto-save.
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border/60 p-3">
        {attached.length > 0 && (
          <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5">
            {attached.map((b) => (
              <span
                key={b.uri}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px]"
                title={b.uri}
              >
                <Paperclip className="size-3" />
                <span className="max-w-40 truncate">{b.name}</span>
                {b.truncated && <span className="text-amber-600 dark:text-amber-500">·trimmed</span>}
                <button
                  type="button"
                  aria-label={`Remove ${b.name}`}
                  onClick={() => setAttached((a) => a.filter((x) => x.uri !== b.uri))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="Message…  (⌘/Ctrl + Enter to send)"
            className="max-h-40 min-h-10 flex-1 resize-y text-sm"
          />
          {chat?.busy ? (
            <Button size="sm" variant="outline" onClick={() => stopChat()} aria-label="Stop">
              <Loader2 className="size-4 animate-spin" />
              <X className="size-4" />
            </Button>
          ) : (
            <Button size="sm" disabled={!connId || !model || !draft.trim()} onClick={send} aria-label="Send">
              <Send className="size-4" />
            </Button>
          )}
        </div>
      </div>
      </div>

      <ContextPickerDialog
        open={pickCtx}
        onClose={() => setPickCtx(false)}
        attached={attached.map((b) => b.uri)}
        onAdd={(b) => setAttached((a) => (a.some((x) => x.uri === b.uri) ? a : [...a, b]))}
      />
      <PromptPickerDialog
        open={pickPrompt}
        onClose={() => setPickPrompt(false)}
        onPicked={(text) => setDraft((d) => (d.trim() ? `${d}\n\n${text}` : text))}
      />
    </div>
  )
}

function fmtTok(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function safeGet(k: string): string {
  try {
    return localStorage.getItem(k) ?? ''
  } catch {
    return ''
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* ignore */
  }
}
