import { GitCompare, Pin, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { latestVersion, type Runbook } from '@/core/runbook/runbookModel'
import { cn } from '@/lib/utils'

function rel(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}

interface Props {
  runbook: Runbook
  viewing: number | null
  compareSel: number[]
  dirty: boolean
  onView: (n: number | null) => void
  onToggleCompare: (n: number) => void
  onRestore: (n: number) => void
  onPin: (n: number, pinned: boolean) => void
  onDelete: (n: number) => void
  onDiscardDraft: () => void
  onCompare: () => void
}

export function RunbookVersionList({
  runbook,
  viewing,
  compareSel,
  dirty,
  onView,
  onToggleCompare,
  onRestore,
  onPin,
  onDelete,
  onDiscardDraft,
  onCompare,
}: Props) {
  const versions = [...runbook.versions].sort((a, b) => b.version - a.version)
  const latest = latestVersion(runbook)
  const neverSaved = versions.length === 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Versions</p>
        <Button size="xs" variant="outline" disabled={compareSel.length !== 2} onClick={onCompare}>
          <GitCompare className="size-3" /> Compare
        </Button>
      </div>

      {neverSaved && !dirty && (
        <p className="text-xs text-muted-foreground">No versions yet. Press Save to create v1.</p>
      )}

      <ul className="flex flex-col gap-0.5">
        {dirty && (
          <li
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
              viewing == null ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40',
            )}
          >
            <button type="button" onClick={() => onView(null)} className="flex flex-1 items-center gap-1.5 text-left">
              <span className="size-1.5 rounded-full bg-amber-500" />
              <span className="font-medium">{neverSaved ? 'Draft — not saved yet' : 'Unsaved changes'}</span>
            </button>
            {!neverSaved && (
              <button
                type="button"
                aria-label="Discard draft"
                title="Discard draft"
                onClick={onDiscardDraft}
                className="text-muted-foreground hover:text-destructive"
              >
                <RotateCcw className="size-3.5" />
              </button>
            )}
          </li>
        )}

        {versions.map((v) => {
          const isLatest = v.version === latest?.version
          return (
            <li
              key={v.version}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                viewing === v.version ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40',
              )}
            >
              <input
                type="checkbox"
                aria-label={`Select v${v.version} to compare`}
                checked={compareSel.includes(v.version)}
                onChange={() => onToggleCompare(v.version)}
                className="size-3 shrink-0 accent-primary"
              />
              <button
                type="button"
                onClick={() => onView(isLatest && !dirty ? null : v.version)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <span className="font-medium">v{v.version}</span>
                {isLatest && <span className="text-muted-foreground">latest</span>}
                <span className="truncate text-muted-foreground">· {rel(v.createdAt)}</span>
              </button>
              <button
                type="button"
                aria-label={v.pinned ? 'Unpin' : 'Pin'}
                onClick={() => onPin(v.version, !v.pinned)}
                className={cn('shrink-0', v.pinned ? 'text-primary' : 'text-muted-foreground/50 hover:text-foreground')}
              >
                <Pin className={cn('size-3.5', v.pinned && 'fill-current')} />
              </button>
              <button
                type="button"
                aria-label={`Restore v${v.version}`}
                title="Restore into draft"
                onClick={() => onRestore(v.version)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Delete v${v.version}`}
                disabled={isLatest || v.pinned}
                onClick={() => onDelete(v.version)}
                className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          )
        })}
      </ul>
      {compareSel.length === 1 && (
        <p className="text-[11px] text-muted-foreground">Pick one more version to compare.</p>
      )}
    </div>
  )
}
