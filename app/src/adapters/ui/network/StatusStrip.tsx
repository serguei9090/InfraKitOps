import type { ReactNode } from 'react'
import { useBackendStore } from '@/stores/backendStore'
import { cn } from '@/lib/utils'

interface StatusStripProps {
  /** 0..1 — omit for no progress bar. */
  progress?: number
  running?: boolean
  /** Left-cluster status items (elapsed, counts, …). */
  items?: ReactNode[]
}

/**
 * Bottom status strip for the T4 archetype: an optional progress bar plus a
 * left cluster of tool-supplied status items and a right cluster showing the
 * backend connection + interface. See NETWORK_MODULE_PLAN.md §3.
 */
export function StatusStrip({ progress, running, items = [] }: StatusStripProps) {
  const status = useBackendStore((s) => s.status)
  const health = useBackendStore((s) => s.health)

  const pct = progress === undefined ? null : Math.max(0, Math.min(1, progress)) * 100

  return (
    <div className="border-t border-border/60 bg-background">
      {pct !== null ? (
        <div className="h-0.5 w-full bg-muted">
          <div
            className={cn('h-full bg-primary transition-[width] duration-200', running && 'animate-pulse')}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      <div className="flex items-center gap-4 px-5 py-1.5 text-[11px] text-muted-foreground">
        <div className="flex flex-1 items-center gap-4 font-mono tabular-nums">
          {items.map((item, i) => (
            <span key={i}>{item}</span>
          ))}
        </div>
        {health?.os ? <span className="font-mono">{health.os}</span> : null}
        <span className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              'size-1.5 rounded-full',
              status === 'available' && 'bg-emerald-500',
              status === 'connecting' && 'bg-amber-500',
              (status === 'unavailable' || status === 'unknown') && 'bg-muted-foreground/40',
            )}
          />
          backend {status === 'available' ? 'connected' : status}
        </span>
      </div>
    </div>
  )
}
