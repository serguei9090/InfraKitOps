import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Shared result-panel bits for the Tuning & Performance calculators (Load
 * Balancer Sizer, Connection Pool Sizer, K8s Capacity, …). Every sizer's
 * results read the same way — a row of headline stat cards, then one or two
 * labelled breakdown tables, then the "rule of thumb, not a load test"
 * caveat — so those pieces live here instead of in six screens.
 */

export function StatCard({
  label,
  value,
  sub,
  tone = 'primary',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'primary' | 'muted' | 'warn'
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg p-4',
        tone === 'primary' && 'bg-primary/10',
        tone === 'muted' && 'bg-muted/50',
        tone === 'warn' && 'bg-destructive/10',
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          'text-2xl font-semibold',
          tone === 'primary' && 'text-primary',
          tone === 'warn' && 'text-destructive',
        )}
      >
        {value}
      </p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
}

export function BreakdownTable({
  title,
  rows,
}: {
  title?: string
  /** [label, value, emphasis?] */
  rows: [string, ReactNode, boolean?][]
}) {
  return (
    <div className="flex flex-col gap-2">
      {title ? <p className="text-xs font-medium text-muted-foreground">{title}</p> : null}
      <div className="divide-y divide-border rounded-lg border border-border">
        {rows.map(([label, value, emphasis], i) => (
          <div key={`${label}-${i}`} className="flex items-center justify-between gap-4 px-3 py-2">
            <span className={emphasis ? 'text-sm font-medium' : 'text-sm text-muted-foreground'}>{label}</span>
            <span className={emphasis ? 'font-mono text-sm font-semibold' : 'font-mono text-sm'}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SizerCaveat({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}
