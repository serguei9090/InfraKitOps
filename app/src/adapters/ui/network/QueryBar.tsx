import { ChevronDown, Loader2, Play, Square } from 'lucide-react'
import type { ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface QueryBarProps {
  /** Inline field controls (host input, mode/type selects, …). */
  children: ReactNode
  /** Extra controls revealed by the "Advanced parameters" disclosure. */
  advanced?: ReactNode
  onRun: () => void
  /** When set, the primary button becomes a Stop button that calls this. */
  onStop?: () => void
  running?: boolean
  canRun?: boolean
  /** Verb on the primary button — "Query" | "Scan" | "Trace" | "Ping" | … */
  runLabel?: string
}

/**
 * Top-of-tool query bar for the T4 "Network Console" archetype: a full-width
 * card with an inline field row, a primary run/stop action, and an optional
 * collapsible advanced-parameters section. See NETWORK_MODULE_PLAN.md §3.
 */
export function QueryBar({
  children,
  advanced,
  onRun,
  onStop,
  running = false,
  canRun = true,
  runLabel = 'Query',
}: QueryBarProps) {
  const showStop = running && onStop
  return (
    <div className="rounded-lg border border-border/60 bg-background p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">{children}</div>
        {showStop ? (
          <Button variant="outline" onClick={onStop} className="gap-1.5">
            <Square className="size-4" />
            Stop
          </Button>
        ) : (
          <Button onClick={onRun} disabled={!canRun || running} className="gap-1.5">
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {running ? 'Running…' : runLabel}
          </Button>
        )}
      </div>

      {advanced ? (
        <Collapsible className="mt-3">
          <CollapsibleTrigger
            className={cn(
              'group inline-flex items-center gap-1 text-xs font-medium text-muted-foreground',
              'hover:text-foreground',
            )}
          >
            <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
            Advanced parameters
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="flex flex-wrap items-end gap-3 border-t border-border/60 pt-3">{advanced}</div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}

/** Small labelled field wrapper matched to the query bar's density. */
export function QueryField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}
