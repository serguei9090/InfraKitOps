import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useLlmStore } from '@/stores/llmStore'
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
  const resetChat = useLlmStore((s) => s.resetChat)

  const [connId, setConnId] = useState('')
  const [model, setModel] = useState('')
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

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
    sendMessage(draft)
    setDraft('')
  }

  if (connections.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Add a connection first — see the <span className="mx-1 font-medium">Connections</span> tab.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2">
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
        <div className="flex-1" />
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
              <pre className="whitespace-pre-wrap break-words font-sans">{t.content || (t.error ?? '')}</pre>
            </div>
          ))}
          {!chat?.turns.length && (
            <p className="py-16 text-center text-xs text-muted-foreground">
              Pick a model and send a message. Conversations here are not saved.
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border/60 p-3">
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
          <Button size="sm" disabled={!connId || !model || !draft.trim() || chat?.busy} onClick={send}>
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
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
