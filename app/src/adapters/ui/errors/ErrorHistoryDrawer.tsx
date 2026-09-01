import { useState } from 'react'
import { Bell, Copy, Trash2, X } from 'lucide-react'
import { useErrorStore, type SurfacedError } from '@/stores/errorStore'
import { cn } from '@/lib/utils'
import { ErrorIcon } from './errorIcon'

function rel(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

/**
 * E3b — a header bell that opens a drawer of every error this session
 * (`errorStore.history`, cap 50). Badge counts errors since the drawer was
 * last opened.
 */
export function ErrorHistoryButton() {
  const history = useErrorStore((s) => s.history)
  const seenAt = useErrorStore((s) => s.historySeenAt)
  const markSeen = useErrorStore((s) => s.markHistorySeen)
  const [open, setOpen] = useState(false)

  const unseen = history.filter((e) => e.at > seenAt).length

  return (
    <>
      <button
        type="button"
        aria-label="Error history"
        onClick={() => {
          setOpen(true)
          markSeen()
        }}
        className="relative flex size-9 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      >
        <Bell className="size-[18px]" />
        {unseen > 0 && (
          <span className="absolute right-1 top-1 flex min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold leading-none text-destructive-foreground">
            {unseen > 9 ? '9+' : unseen}
          </span>
        )}
      </button>
      {open && <Drawer onClose={() => setOpen(false)} />}
    </>
  )
}

function Drawer({ onClose }: { onClose: () => void }) {
  const history = useErrorStore((s) => s.history)
  const clearHistory = useErrorStore((s) => s.clearHistory)

  const copyAll = () => {
    const text = history
      .map((e) => `[${new Date(e.at).toISOString()}] ${e.source ?? '?'} · ${e.code} · ${e.title}\n  ${e.detail ?? ''}`)
      .join('\n')
    void navigator.clipboard?.writeText(text)
  }

  return (
    <div className="fixed inset-0 z-[110] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div
        className="relative flex h-full w-[min(26rem,calc(100vw-2rem))] flex-col border-l border-border/70 bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <span className="text-sm font-semibold">Error history</span>
          <span className="text-xs text-muted-foreground">{history.length}</span>
          <div className="flex-1" />
          <button
            type="button"
            aria-label="Copy all"
            onClick={copyAll}
            disabled={history.length === 0}
            className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Clear history"
            onClick={clearHistory}
            disabled={history.length === 0}
            className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
          </button>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {history.length === 0 ? (
            <p className="py-16 text-center text-xs text-muted-foreground">No errors this session.</p>
          ) : (
            [...history].reverse().map((e) => <Row key={e.id} error={e} />)
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ error }: { error: SurfacedError }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md px-2 py-1.5 text-sm hover:bg-accent/30">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2 text-left">
        <ErrorIcon code={error.code} className="mt-0.5 size-3.5 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="flex-1 truncate font-medium">{error.title}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{rel(error.at)}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {error.source ?? '—'} · {error.code}
          </div>
        </div>
      </button>
      {open && (error.hint || (error.detail && error.detail !== error.title)) && (
        <div className="mt-1 pl-6 text-[11px] text-muted-foreground">
          {error.hint && <p>{error.hint}</p>}
          {error.detail && error.detail !== error.title && (
            <pre className={cn('mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono')}>
              {error.detail}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
