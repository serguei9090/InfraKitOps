import { useEffect, useMemo, useRef, useState } from 'react'
import { diffWordsWithSpace } from 'diff'
import { Check, Loader2, Send, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useLlmStore } from '@/stores/llmStore'
import type { ChatMessage } from '@/core/llm/llmModel'
import { useLlm } from './useLlm'
import { cn } from '@/lib/utils'

interface Props {
  /** built-in or custom task id, e.g. "prompt.improve" */
  taskId: string
  /** grounding — string values, substituted into the task's {{context.*}} slots */
  context: Record<string, string>
  mode?: 'oneshot' | 'chat'
  /** which context key holds the "before" text for a diff-shaped task */
  diffKey?: string
  /** called with the accepted result (oneshot diff/text tasks) */
  onAccept?: (text: string) => void
  /** called with the parsed JSON (oneshot json-shaped tasks) */
  onAcceptJson?: (value: unknown) => void
  onClose?: () => void
  className?: string
}

const lastKey = (taskId: string) => `infrakit:ai-panel:${taskId}`

export function AiPanel({
  taskId,
  context,
  mode = 'oneshot',
  diffKey = 'text',
  onAccept,
  onAcceptJson,
  onClose,
  className,
}: Props) {
  const connections = useLlmStore((s) => s.connections)
  const models = useLlmStore((s) => s.models)
  const loadModels = useLlmStore((s) => s.loadModels)
  const refresh = useLlmStore((s) => s.refresh)
  const tasks = useLlmStore((s) => s.tasks)
  const refreshTasks = useLlmStore((s) => s.refreshTasks)

  const task = useMemo(() => tasks.find((t) => t.id === taskId), [tasks, taskId])
  const { running, text, parsed, error, usage, run, reset } = useLlm(taskId)

  const [connId, setConnId] = useState('')
  const [model, setModel] = useState('')
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState<ChatMessage[]>([])
  const pendingRef = useRef(false)

  useEffect(() => {
    if (connections.length === 0) void refresh()
    if (tasks.length === 0) void refreshTasks()
  }, [connections.length, tasks.length, refresh, refreshTasks])

  useEffect(() => {
    if (connId || connections.length === 0) return
    let saved: { connId?: string; model?: string } = {}
    try {
      saved = JSON.parse(localStorage.getItem(lastKey(taskId)) ?? '{}')
    } catch {
      /* ignore */
    }
    const pick = connections.find((c) => c.id === saved.connId) ?? connections[0]
    setConnId(pick.id)
    setModel(saved.model || task?.suggestedModel || pick.defaultModel || '')
  }, [connections, connId, taskId, task])

  useEffect(() => {
    if (connId) void loadModels(connId)
  }, [connId, loadModels])

  // chat: when a run finishes, commit the assistant reply into the turn list
  useEffect(() => {
    if (mode !== 'chat' || running || !pendingRef.current) return
    pendingRef.current = false
    if (text) setTurns((t) => [...t, { role: 'assistant', content: text }])
    reset()
  }, [mode, running, text, reset])

  const connModels = models[connId] ?? []
  const before = context[diffKey] ?? ''
  const isDiff = task?.outputShape === 'diff'

  function rememberPick() {
    try {
      localStorage.setItem(lastKey(taskId), JSON.stringify({ connId, model }))
    } catch {
      /* ignore */
    }
  }

  function runOnce() {
    if (!connId || !model) return
    rememberPick()
    run({ connId, model, context, input })
  }

  function sendChat() {
    if (!connId || !model || !input.trim() || running) return
    rememberPick()
    const msg = input.trim()
    setTurns((t) => [...t, { role: 'user', content: msg }])
    pendingRef.current = true
    run({ connId, model, context, input: msg, history: turns })
    setInput('')
  }

  if (connections.length === 0) {
    return (
      <div className={cn('rounded-lg border border-border/60 bg-card p-3 text-xs text-muted-foreground', className)}>
        No LLM connection yet — add one in <span className="font-medium">AI Hub → Connections</span>.
      </div>
    )
  }

  const picker = (
    <div className="flex flex-wrap gap-2">
      <Select value={connId} onValueChange={(v) => v && setConnId(v)}>
        <SelectTrigger size="sm" className="w-40 text-xs">
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
        <SelectTrigger size="sm" className="w-48 text-xs">
          <SelectValue placeholder={connModels.length ? 'model' : 'test the connection first'} />
        </SelectTrigger>
        <SelectContent>
          {connModels.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border border-border/60 bg-card p-3', className)}>
      <div className="flex items-center gap-2">
        <Sparkles className="size-3.5 text-primary" />
        <span className="text-xs font-medium">{task?.title ?? taskId}</span>
        <div className="flex-1" />
        {usage && (
          <span className="text-[10px] text-muted-foreground">
            {usage.promptTokens}+{usage.completionTokens} tok
          </span>
        )}
        {onClose && (
          <button type="button" aria-label="Close" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {picker}

      {mode === 'chat' ? (
        <>
          {(turns.length > 0 || running) && (
            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-md border border-border/50 bg-background p-2">
              {turns.map((m, i) => (
                <ChatBubble key={i} role={m.role} content={m.content} />
              ))}
              {running && <ChatBubble role="assistant" content={text || '…'} />}
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  sendChat()
                }
              }}
              placeholder={task?.inputLabel ?? 'Message… (⌘/Ctrl+Enter)'}
              className="min-h-9 flex-1 resize-y text-xs"
            />
            <Button size="xs" onClick={sendChat} disabled={!connId || !model || !input.trim() || running}>
              {running ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            </Button>
          </div>
          {turns.length > 0 && !running && (
            <Button
              size="xs"
              variant="ghost"
              className="self-start"
              onClick={() => {
                setTurns([])
                reset()
              }}
            >
              Clear conversation
            </Button>
          )}
        </>
      ) : (
        <>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={task?.inputLabel ?? 'Instruction (optional)'}
            className="min-h-9 resize-y text-xs"
          />
          <div className="flex items-center gap-2">
            <Button size="xs" onClick={runOnce} disabled={!connId || !model || running}>
              {running ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {running ? 'Running…' : 'Run'}
            </Button>
            {(text || error) && !running && (
              <Button size="xs" variant="ghost" onClick={reset}>
                Clear
              </Button>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {text && (
            <div className="rounded-md border border-border/50 bg-background p-2 text-xs">
              {isDiff && before ? (
                <pre className="whitespace-pre-wrap break-words font-sans leading-relaxed">
                  {diffWordsWithSpace(before, text).map((part, i) =>
                    part.added ? (
                      <span key={i} className="rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                        {part.value}
                      </span>
                    ) : part.removed ? (
                      <span key={i} className="rounded bg-destructive/15 text-destructive line-through">
                        {part.value}
                      </span>
                    ) : (
                      <span key={i}>{part.value}</span>
                    ),
                  )}
                </pre>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-sans">{text}</pre>
              )}
            </div>
          )}

          {text && !running && (onAccept || onAcceptJson) && (
            <div className="flex gap-2">
              <Button
                size="xs"
                disabled={task?.outputShape === 'json' && parsed === undefined}
                onClick={() => {
                  if (task?.outputShape === 'json' && onAcceptJson) onAcceptJson(parsed)
                  else onAccept?.(text)
                  reset()
                  onClose?.()
                }}
              >
                <Check className="size-3.5" /> {isDiff ? 'Accept' : 'Use this'}
              </Button>
              <Button size="xs" variant="ghost" onClick={reset}>
                Discard
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ChatBubble({ role, content }: { role: string; content: string }) {
  return (
    <div
      className={cn(
        'rounded-md px-2 py-1.5 text-xs',
        role === 'user' ? 'bg-card' : 'bg-primary/5',
      )}
    >
      <div className="mb-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{role}</div>
      <pre className="whitespace-pre-wrap break-words font-sans">{content}</pre>
    </div>
  )
}
