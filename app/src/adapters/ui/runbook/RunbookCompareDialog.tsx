import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { diffSpecs, diffSummary, type StepDiff } from '@/core/runbook/runbookDiff'
import type { Runbook } from '@/core/runbook/runbookModel'
import { cn } from '@/lib/utils'

const STEP_STYLE: Record<StepDiff['kind'], string> = {
  unchanged: 'border-border/60',
  added: 'border-emerald-500/50 bg-emerald-500/5',
  removed: 'border-destructive/50 bg-destructive/5',
  changed: 'border-amber-500/50 bg-amber-500/5',
}

interface Props {
  runbook: Runbook
  versions: number[] // exactly 2
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RunbookCompareDialog({ runbook, versions, open, onOpenChange }: Props) {
  const [onlyDiffs, setOnlyDiffs] = useState(true)
  const [a, b] = useMemo(() => [...versions].sort((x, y) => x - y), [versions])

  const specA = runbook.versions.find((v) => v.version === a)?.spec
  const specB = runbook.versions.find((v) => v.version === b)?.spec
  const diff = useMemo(() => (specA && specB ? diffSpecs(specA, specB) : null), [specA, specB])

  if (!diff) return null
  const sum = diffSummary(diff)
  const steps = onlyDiffs ? diff.steps.filter((s) => s.kind !== 'unchanged') : diff.steps
  const fields = onlyDiffs ? diff.fields.filter((f) => f.kind === 'changed') : diff.fields
  const args = onlyDiffs ? diff.args.filter((a) => a.kind !== 'unchanged') : diff.args

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>
            Compare v{a} → v{b}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{sum.fields} field{sum.fields === 1 ? '' : 's'}</span>
          <span>{sum.args} arg{sum.args === 1 ? '' : 's'}</span>
          <span className="text-emerald-600 dark:text-emerald-500">+{sum.stepsAdded}</span>
          <span className="text-destructive">−{sum.stepsRemoved}</span>
          <span className="text-amber-600 dark:text-amber-500">~{sum.stepsChanged} steps</span>
          <div className="flex-1" />
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={onlyDiffs} onChange={(e) => setOnlyDiffs(e.target.checked)} className="size-3 accent-primary" />
            Only differences
          </label>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {fields.length > 0 && (
            <div className="flex flex-col gap-1">
              {fields.map((f) => (
                <div key={f.label} className="rounded-md border border-border/60 p-2 text-xs">
                  <span className="font-medium">{f.label}</span>{' '}
                  {f.kind === 'unchanged' ? (
                    <span className="text-muted-foreground">{f.after || '(empty)'}</span>
                  ) : (
                    <span className="font-mono">
                      {f.wordDiff?.map((c, i) => (
                        <span
                          key={i}
                          className={cn(
                            c.added && 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
                            c.removed && 'bg-destructive/20 text-destructive line-through',
                          )}
                        >
                          {c.value}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {args.length > 0 && (
            <div className="flex flex-col gap-1">
              {args.map((a) => (
                <div
                  key={a.name}
                  className={cn(
                    'rounded-md border p-2 text-xs',
                    a.kind === 'added' && 'border-emerald-500/50 bg-emerald-500/5',
                    a.kind === 'removed' && 'border-destructive/50 bg-destructive/5',
                    a.kind === 'changed' && 'border-amber-500/50 bg-amber-500/5',
                    a.kind === 'unchanged' && 'border-border/60',
                  )}
                >
                  <span className="font-mono font-medium">{`{{${a.name}}}`}</span>{' '}
                  <span className="text-muted-foreground">{a.kind}</span>
                  {a.kind === 'changed' && (
                    <div className="mt-0.5 font-mono">
                      <div className="text-destructive line-through">{a.before}</div>
                      <div className="text-emerald-700 dark:text-emerald-300">{a.after}</div>
                    </div>
                  )}
                  {(a.kind === 'added' || a.kind === 'removed') && (
                    <div className="mt-0.5 font-mono text-muted-foreground">{a.after ?? a.before}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {steps.length === 0 && fields.length === 0 && args.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No differences.</p>
          ) : (
            steps.map((s, i) => (
              <div key={i} className={cn('rounded-lg border p-2.5', STEP_STYLE[s.kind])}>
                <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                  <span>{s.name || 'step'}</span>
                  <span className="text-muted-foreground">
                    {s.kind}
                    {s.executorBefore && s.executorAfter && s.executorBefore !== s.executorAfter
                      ? ` · ${s.executorBefore} → ${s.executorAfter}`
                      : s.executorAfter
                        ? ` · ${s.executorAfter}`
                        : s.executorBefore
                          ? ` · ${s.executorBefore}`
                          : ''}
                  </span>
                </div>
                {s.scriptWordDiff ? (
                  <pre className="whitespace-pre-wrap break-words font-mono text-[12px]">
                    {s.scriptWordDiff.map((c, j) => (
                      <span
                        key={j}
                        className={cn(
                          c.added && 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
                          c.removed && 'bg-destructive/20 text-destructive line-through',
                        )}
                      >
                        {c.value}
                      </span>
                    ))}
                  </pre>
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-mono text-[12px]">
                    {s.kind === 'removed' ? s.scriptBefore : s.scriptAfter}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Close</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
