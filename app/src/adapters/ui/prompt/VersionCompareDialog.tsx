import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { diffSummary, diffVersions, type MessageDiff } from '@/core/prompt/promptDiff'
import { versionMessages, type Prompt, type Role } from '@/core/prompt/promptModel'
import { usePromptLibraryStore } from '@/stores/promptLibraryStore'
import { cn } from '@/lib/utils'

const ROLE_LABEL: Record<Role, string> = { system: 'System', user: 'User', assistant: 'Assistant' }

const KIND_STYLE: Record<MessageDiff['kind'], string> = {
  unchanged: 'border-border/60',
  added: 'border-emerald-500/50 bg-emerald-500/5',
  removed: 'border-destructive/50 bg-destructive/5',
  changed: 'border-amber-500/50 bg-amber-500/5',
}

interface VersionCompareDialogProps {
  prompt: Prompt
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VersionCompareDialog({ prompt, open, onOpenChange }: VersionCompareDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl flex-col">
        {open ? <CompareBody prompt={prompt} /> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Close</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CompareBody({ prompt }: { prompt: Prompt }) {
  const selection = usePromptLibraryStore((s) => s.compareSelection)
  const [onlyDiffs, setOnlyDiffs] = useState(true)

  const [a, b] = useMemo(() => [...selection].sort((x, y) => x - y), [selection])
  const diffs = useMemo(
    () => diffVersions(versionMessages(prompt, a) ?? [], versionMessages(prompt, b) ?? []),
    [prompt, a, b],
  )
  const summary = diffSummary(diffs)
  const shown = onlyDiffs ? diffs.filter((d) => d.kind !== 'unchanged') : diffs

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Compare v{a} → v{b}
        </DialogTitle>
      </DialogHeader>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="text-emerald-600 dark:text-emerald-500">+{summary.added} added</span>
        <span className="text-destructive">−{summary.removed} removed</span>
        <span className="text-amber-600 dark:text-amber-500">~{summary.changed} changed</span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={onlyDiffs}
            onChange={(e) => setOnlyDiffs(e.target.checked)}
            className="size-3 accent-primary"
          />
          Only differences
        </label>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No differences.</p>
        ) : (
          shown.map((d, i) => (
            <div key={i} className={cn('rounded-lg border p-2.5', KIND_STYLE[d.kind])}>
              <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                <span>{ROLE_LABEL[d.role]}</span>
                <span className="text-muted-foreground">
                  {d.kind}
                  {d.roleChanged ? ' · role changed' : ''}
                </span>
              </div>
              {d.kind === 'changed' && d.wordDiff ? (
                <p className="whitespace-pre-wrap break-words font-mono text-[13px]">
                  {d.wordDiff.map((c, j) => (
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
                </p>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-[13px]">
                  {d.kind === 'removed' ? d.before : d.after}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </>
  )
}
