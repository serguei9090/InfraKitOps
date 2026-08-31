import { useEffect, useMemo, useState } from 'react'
import { diffWordsWithSpace } from 'diff'
import { Check, Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useLlmStore } from '@/stores/llmStore'
import { useLlm } from './useLlm'
import { cn } from '@/lib/utils'

interface Props {
  /** built-in or custom task id, e.g. "prompt.improve" */
  taskId: string
  /** grounding — string values, substituted into the task's {{context.*}} slots */
  context: Record<string, string>
  mode?: 'oneshot' | 'chat' // chat lands in A2; oneshot for now
  /** which context key holds the "before" text for a diff-shaped task */
  diffKey?: string
  /** called with the accepted result (diff/text tasks) */
  onAccept?: (text: string) => void
  onClose?: () => void
  className?: string
}

const lastKey = (taskId: string) => `infrakit:ai-panel:${taskId}`

export function AiPanel({ taskId, context, diffKey = 'text', onAccept, onClose, className }: Props) {
  const connections = useLlmStore((s) => s.connections)
  const models = useLlmStore((s) => s.models)
  const loadModels = useLlmStore((s) => s.loadModels)
  const refresh = useLlmStore((s) => s.refresh)
  const tasks = useLlmStore((s) => s.tasks)
  const refreshTasks = useLlmStore((s) => s.refreshTasks)

  const task = useMemo(() => tasks.find((t) => t.id === taskId), [tasks, taskId])
  const { running, text, error, usage, run, reset } = useLlm(taskId)

  const [connId, setConnId] = useState('')
  const [model, setModel] = useState('')
  const [input, setInput] = useState('')

  useEffect(() => {
    if (connections.length === 0) void refresh()
    if (tasks.length === 0) void refreshTasks()
  }, [connections.length, tasks.length, refresh, refreshTasks])

  // restore last pick for this task
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

  const connModels = models[connId] ?? []
  const before = context[diffKey] ?? ''
  const isDiff = task?.outputShape === 'diff'

  function go() {
    if (!connId || !model) return
    try {
      localStorage.setItem(lastKey(taskId), JSON.stringify({ connId, model }))
    } catch {
      /* ignore */
    }
    run({ connId, model, context, input })
  }

  if (connections.length === 0) {
    return (
      <div className={cn('rounded-lg border border-border/60 bg-card p-3 text-xs text-muted-foreground', className)}>
        No LLM connection yet — add one in <span className="font-medium">AI Hub → Connections</span>.
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border border-border/60 bg-card p-3', className)}>
      <div className="flex items-center gap-2">
        <Sparkles className="size-3.5 text-primary" />
        <span className="text-xs font-medium">{task?.title ?? taskId}</span>
        <div className="flex-1" />
        {onClose && (
          <button type="button" aria-label="Close" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        )}
      </div>

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

      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={task?.inputLabel ?? 'Instruction (optional)'}
        className="min-h-9 resize-y text-xs"
      />

      <div className="flex items-center gap-2">
        <Button size="xs" onClick={go} disabled={!connId || !model || running}>
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {running ? 'Running…' : 'Run'}
        </Button>
        {(text || error) && !running && (
          <Button size="xs" variant="ghost" onClick={reset}>
            Clear
          </Button>
        )}
        {usage && (
          <span className="text-[10px] text-muted-foreground">
            {usage.promptTokens}+{usage.completionTokens} tok
          </span>
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

      {text && !running && onAccept && (
        <div className="flex gap-2">
          <Button
            size="xs"
            onClick={() => {
              onAccept(text)
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
    </div>
  )
}
