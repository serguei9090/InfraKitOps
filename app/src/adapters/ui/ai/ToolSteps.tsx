import { useState } from 'react'
import { Check, ChevronRight, Loader2, Wrench, X } from 'lucide-react'
import type { ChatToolStep } from '@/core/llm/llmModel'
import { cn } from '@/lib/utils'

/**
 * Renders the tool calls a model made during an assistant turn (A4b). Each is a
 * collapsible row: name + args on top, the result revealed on click.
 */
export function ToolSteps({ steps, className }: { steps: ChatToolStep[]; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {steps.map((s) => (
        <ToolStepRow key={s.id} step={s} />
      ))}
    </div>
  )
}

function ToolStepRow({ step }: { step: ChatToolStep }) {
  const [open, setOpen] = useState(false)
  // "<serverId>__<tool>" → show just the tool name
  const short = step.name.includes('__') ? step.name.split('__').slice(1).join('__') : step.name

  return (
    <div className="rounded-md border border-border/50 bg-background/60 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
      >
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
        <Wrench className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-mono font-medium">{short}</span>
        <div className="flex-1" />
        {!step.done ? (
          <Loader2 className="size-3 animate-spin text-primary" />
        ) : step.ok ? (
          <Check className="size-3 text-emerald-500" />
        ) : (
          <X className="size-3 text-destructive" />
        )}
      </button>
      {open && (
        <div className="border-t border-border/40 px-2 py-1.5">
          {step.args && Object.keys(step.args).length > 0 && (
            <pre className="mb-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
              {JSON.stringify(step.args, null, 2)}
            </pre>
          )}
          {step.done && (
            <pre
              className={cn(
                'max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]',
                !step.ok && 'text-destructive',
              )}
            >
              {step.result || '(no output)'}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
