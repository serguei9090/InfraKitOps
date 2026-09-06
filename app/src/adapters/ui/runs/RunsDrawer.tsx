import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, CircleStop, Loader2, X } from 'lucide-react'
import { useRunsStore } from '@/stores/runsStore'
import { cancelRun, type ActiveRun, type RunModule } from '@/adapters/backend/runsClient'
import { reportError } from '@/stores/errorStore'

function rel(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

const MODULE_ROUTE: Record<RunModule, string> = {
  ansible: '/tools/ansible',
  runbook: '/tools/runbook',
}

/**
 * BR3 — a header button that opens a drawer of the caller's in-flight
 * server-side runs (`runsStore.active`). Runs keep going on the backend when
 * you navigate away; this is how you find your way back to one, or stop it.
 */
export function RunsButton() {
  const active = useRunsStore((s) => s.active)
  const seenIds = useRunsStore((s) => s.seenIds)
  const setDrawerOpen = useRunsStore((s) => s.setDrawerOpen)
  const [open, setOpen] = useState(false)

  const unseen = active.filter((r) => !seenIds.includes(r.id)).length
  const running = active.length

  if (running === 0 && !open) {
    // Keep the chrome quiet when nothing is running.
    return null
  }

  return (
    <>
      <button
        type="button"
        aria-label="Background runs"
        onClick={() => {
          setOpen(true)
          setDrawerOpen(true)
        }}
        className="relative flex size-9 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      >
        {running > 0 ? <Loader2 className="size-[18px] animate-spin" /> : <Activity className="size-[18px]" />}
        {(unseen > 0 || running > 0) && (
          <span className="absolute right-1 top-1 flex min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold leading-none text-primary-foreground">
            {running > 9 ? '9+' : running}
          </span>
        )}
      </button>
      {open && (
        <Drawer
          onClose={() => {
            setOpen(false)
            setDrawerOpen(false)
          }}
        />
      )}
    </>
  )
}

function Drawer({ onClose }: { onClose: () => void }) {
  const active = useRunsStore((s) => s.active)
  const refresh = useRunsStore((s) => s.refresh)

  return (
    <div className="fixed inset-0 z-[110] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div
        className="relative flex h-full w-[min(26rem,calc(100vw-2rem))] flex-col border-l border-border/70 bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <span className="text-sm font-semibold">Background runs</span>
          <span className="text-xs text-muted-foreground">{active.length}</span>
          <div className="flex-1" />
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {active.length === 0 ? (
            <p className="py-16 text-center text-xs text-muted-foreground">Nothing running right now.</p>
          ) : (
            active.map((r) => <Row key={`${r.module}:${r.id}`} run={r} onDone={refresh} onClose={onClose} />)
          )}
        </div>
        <div className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
          Runs continue on the backend if you close this or navigate away.
        </div>
      </div>
    </div>
  )
}

function Row({ run, onDone, onClose }: { run: ActiveRun; onDone: () => void; onClose: () => void }) {
  const navigate = useNavigate()
  const [stopping, setStopping] = useState(false)

  const stop = async () => {
    setStopping(true)
    try {
      await cancelRun(run.module, run.id)
    } catch (e) {
      reportError(e, 'Runs')
    } finally {
      setStopping(false)
      void onDone()
    }
  }

  return (
    <div className="rounded-md px-2 py-1.5 text-sm hover:bg-accent/30">
      <div className="flex items-start gap-2">
        <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />
        <button
          type="button"
          onClick={() => {
            navigate(MODULE_ROUTE[run.module])
            onClose()
          }}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-baseline gap-2">
            <span className="flex-1 truncate font-medium">{run.target || `run ${run.id}`}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{rel(run.startedAt)}</span>
          </div>
          <div className="text-[11px] capitalize text-muted-foreground">
            {run.module} · {run.status}
          </div>
        </button>
        <button
          type="button"
          aria-label="Cancel run"
          onClick={stop}
          disabled={stopping}
          className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-40"
        >
          <CircleStop className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
