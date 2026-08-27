import { GitCompare, History, Loader2, Pin, PinOff, RotateCcw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { deleteRun, getRun, listRuns, pinRun } from '@/adapters/backend/historyClient'
import { Button } from '@/components/ui/button'
import { diffRuns, type RunDiff, type RunSummary, type StoredRun } from '@/core/network/history'
import { cn } from '@/lib/utils'
import { RunComparePanel } from './RunComparePanel'

interface HistoryDrawerProps {
  toolId: string
  /** When set, a toggle lets the user narrow the list to this target. */
  target?: string
  /** Bumping this refetches the list (e.g. after a new run completes). */
  refreshKey?: number
  /** Re-render a past run in the tool's normal view. */
  onRestore: (run: StoredRun) => void
}

/**
 * Slide-over history panel: reverse-chron runs for this tool, restore a past
 * run, pin/delete, and an inline "what changed since the previous run" diff.
 * The full A/B Compare view lands in N2. See NETWORK_MODULE_PLAN.md §2.3.
 */
export function HistoryDrawer({ toolId, target, refreshKey, onRestore }: HistoryDrawerProps) {
  const [open, setOpen] = useState(false)
  const [onlyTarget, setOnlyTarget] = useState(true)
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [diff, setDiff] = useState<{ id: number; value: RunDiff } | null>(null)
  const [comparing, setComparing] = useState(false)

  const refresh = useCallback(async () => {
    const list = await listRuns(toolId, onlyTarget && target ? target : undefined, 100)
    setRuns(list)
  }, [toolId, target, onlyTarget])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh, refreshKey])

  async function restore(id: number) {
    const run = await getRun(id)
    if (run) {
      onRestore(run)
      setOpen(false)
    }
  }

  async function toggleDiff(row: RunSummary) {
    if (expanded === row.id) {
      setExpanded(null)
      setDiff(null)
      return
    }
    setExpanded(row.id)
    setDiff(null)
    // Diff against the immediately-older run for the same target.
    const older = (runs ?? []).find((r) => r.target === row.target && r.startedAt < row.startedAt)
    if (!older) return
    const [a, b] = await Promise.all([getRun(older.id), getRun(row.id)])
    if (a && b) setDiff({ id: row.id, value: diffRuns(a, b) })
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <History className="size-4" />
        History
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Run history">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="relative flex h-full w-[26rem] max-w-[90vw] flex-col border-l border-border bg-background shadow-xl">
            {comparing && runs && runs.length >= 2 ? (
              <RunComparePanel runs={runs} onBack={() => setComparing(false)} />
            ) : (
            <>
            <div className="flex h-14 items-center justify-between border-b border-border/60 px-4">
              <h2 className="text-sm font-semibold">Run history</h2>
              <div className="flex items-center gap-1">
                {runs && runs.length >= 2 ? (
                  <Button variant="outline" size="xs" className="gap-1" onClick={() => setComparing(true)}>
                    <GitCompare className="size-3" />
                    Compare
                  </Button>
                ) : null}
                {target ? (
                  <Button variant="outline" size="xs" onClick={() => setOnlyTarget((v) => !v)}>
                    {onlyTarget ? 'This target' : 'All targets'}
                  </Button>
                ) : null}
                <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setOpen(false)}>
                  <X className="size-4" />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {!runs ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : runs.length === 0 ? (
                <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                  No saved runs yet. Runs are stored automatically after each query.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {runs.map((row) => (
                    <li key={row.id} className="rounded-lg border border-border/60">
                      <button
                        type="button"
                        onClick={() => toggleDiff(row)}
                        className={cn(
                          'flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm',
                          expanded === row.id && 'bg-muted/50',
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs">{fmtTime(row.startedAt)}</span>
                          <StatusDot status={row.status} pinned={row.pinned} />
                        </span>
                        {onlyTarget && target ? null : (
                          <span className="truncate font-mono text-xs text-muted-foreground">{row.target}</span>
                        )}
                        <span className="text-xs text-muted-foreground">{summaryLine(row)}</span>
                      </button>

                      {expanded === row.id ? (
                        <div className="border-t border-border/60 px-3 py-2">
                          <DiffPreview diff={diff?.id === row.id ? diff.value : null} />
                          <div className="mt-2 flex gap-1.5">
                            <Button size="xs" variant="secondary" onClick={() => restore(row.id)} className="gap-1">
                              <RotateCcw className="size-3" /> Restore
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={async () => {
                                await pinRun(row.id, !row.pinned)
                                void refresh()
                              }}
                              className="gap-1"
                            >
                              {row.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                              {row.pinned ? 'Unpin' : 'Pin'}
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={async () => {
                                await deleteRun(row.id)
                                void refresh()
                              }}
                              className="gap-1 text-destructive"
                            >
                              <Trash2 className="size-3" /> Delete
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </>
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}

function DiffPreview({ diff }: { diff: RunDiff | null }) {
  if (!diff) return <p className="text-xs text-muted-foreground">No earlier run to compare against.</p>
  switch (diff.kind) {
    case 'set':
      if (diff.added.length === 0 && diff.removed.length === 0)
        return <p className="text-xs text-muted-foreground">No changes since the previous run.</p>
      return (
        <div className="space-y-0.5 text-xs">
          {diff.added.map((i) => (
            <p key={`a${i.key}`} className="text-emerald-600 dark:text-emerald-400">+ {i.label} {i.detail ?? i.key}</p>
          ))}
          {diff.removed.map((i) => (
            <p key={`r${i.key}`} className="text-destructive">− {i.label} {i.detail ?? i.key}</p>
          ))}
        </div>
      )
    case 'scalar_series':
      return (
        <div className="space-y-0.5 text-xs">
          {diff.deltas.map((d) => (
            <p key={d.stat}>
              {d.stat}: {d.a} → {d.b}{' '}
              <span className={d.delta > 0 ? 'text-destructive' : d.delta < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                ({d.delta > 0 ? '+' : ''}
                {d.delta} {diff.unit})
              </span>
            </p>
          ))}
        </div>
      )
    case 'text':
      if (diff.addedCount === 0 && diff.removedCount === 0)
        return <p className="text-xs text-muted-foreground">No meaningful text changes since the previous run.</p>
      return (
        <p className="text-xs">
          <span className="text-emerald-600 dark:text-emerald-400">+{diff.addedCount}</span>{' '}
          <span className="text-destructive">−{diff.removedCount}</span> lines changed
        </p>
      )
    default:
      return <p className="text-xs text-muted-foreground">Diff not available for this result type yet.</p>
  }
}

function StatusDot({ status, pinned }: { status: string; pinned: boolean }) {
  return (
    <span className="flex items-center gap-1">
      {pinned ? <Pin className="size-3 text-muted-foreground" /> : null}
      <span
        className={cn(
          'size-1.5 rounded-full',
          status === 'ok' && 'bg-emerald-500',
          status === 'partial' && 'bg-amber-500',
          (status === 'error' || status === 'timeout') && 'bg-destructive',
        )}
      />
    </span>
  )
}

function summaryLine(row: RunSummary): string {
  const s = row.summary
  if (!s) return row.status
  const parts = Object.entries(s)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${typeof v === 'number' ? round(v) : v}`)
  return parts.join(' · ') || row.status
}

function round(n: number): number {
  return Math.abs(n) < 1 ? Math.round(n * 1000) / 1000 : Math.round(n * 100) / 100
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const now = Date.now()
  const diffMin = Math.round((now - ms) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin} min ago`
  if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)} h ago`
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
