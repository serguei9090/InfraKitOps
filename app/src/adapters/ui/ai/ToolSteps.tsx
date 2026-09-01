import { useState } from 'react'
import { Check, ChevronRight, Loader2, ShieldQuestion, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ChatToolStep } from '@/core/llm/llmModel'
import { cn } from '@/lib/utils'

interface Props {
  steps: ChatToolStep[]
  className?: string
  onApprove?: (approvalId: string) => void
  onDeny?: (approvalId: string) => void
}

/**
 * Renders the tool calls a model made during an assistant turn (A4b/A4c). Each
 * is a collapsible row: name + args on top, the result revealed on click. A
 * call that needs approval (A4c) shows Approve / Deny.
 */
export function ToolSteps({ steps, className, onApprove, onDeny }: Props) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {steps.map((s) => (
        <ToolStepRow key={s.id} step={s} onApprove={onApprove} onDeny={onDeny} />
      ))}
    </div>
  )
}

function ToolStepRow({
  step,
  onApprove,
  onDeny,
}: {
  step: ChatToolStep
  onApprove?: (approvalId: string) => void
  onDeny?: (approvalId: string) => void
}) {
  const pending = Boolean(step.approvalId) && !step.done
  const [open, setOpen] = useState(pending)
  // "<serverId>__<tool>" → show just the tool name
  const short = step.name.includes('__') ? step.name.split('__').slice(1).join('__') : step.name

  return (
    <div
      className={cn(
        'rounded-md border text-xs',
        pending ? 'border-amber-500/50 bg-amber-500/5' : 'border-border/50 bg-background/60',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
      >
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
        <Wrench className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-mono font-medium">{short}</span>
        <div className="flex-1" />
        {pending ? (
          <ShieldQuestion className="size-3 text-amber-500" />
        ) : !step.done ? (
          <Loader2 className="size-3 animate-spin text-primary" />
        ) : step.denied ? (
          <span className="text-[10px] text-muted-foreground">declined</span>
        ) : step.ok ? (
          <Check className="size-3 text-emerald-500" />
        ) : (
          <X className="size-3 text-destructive" />
        )}
      </button>

      {pending && (
        <div className="flex items-center gap-2 border-t border-amber-500/30 px-2 py-1.5">
          <span className="text-[11px] text-muted-foreground">Run this tool?</span>
          <div className="flex-1" />
          <Button size="xs" variant="outline" onClick={() => onDeny?.(step.approvalId!)}>
            Deny
          </Button>
          <Button size="xs" onClick={() => onApprove?.(step.approvalId!)}>
            Approve
          </Button>
        </div>
      )}
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
