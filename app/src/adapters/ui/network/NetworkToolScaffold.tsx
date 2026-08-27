import { useEffect, useState, type ReactNode } from 'react'
import { useBackendStore } from '@/stores/backendStore'
import { cn } from '@/lib/utils'
import { BackendUnavailable } from './BackendUnavailable'

interface NetworkToolScaffoldProps {
  title: string
  /** Tool id from moduleTaxonomy — used for capability gating and (later) history. */
  toolId: string
  /** The QueryBar. */
  queryBar: ReactNode
  /** Full-width results region (table, chart, hop list, …). */
  results: ReactNode
  /** Optional bottom StatusStrip. */
  statusStrip?: ReactNode
  /** Optional right-hand SavedTargetsPane (collapsible in the tool). */
  savedTargets?: ReactNode
  /** Header actions (History / Export / Copy). */
  headerActions?: ReactNode
}

/**
 * T4 "Network Console" archetype — the shared layout for every backend-driven
 * Network Toolkit tool: a header with actions, a top query bar, a full-width
 * streaming results region, an optional saved-targets pane, and a bottom
 * status strip. Falls back to a "backend unavailable" state so a missing
 * sidecar never shows a broken tool. See NETWORK_MODULE_PLAN.md §3.
 */
export function NetworkToolScaffold({
  title,
  toolId,
  queryBar,
  results,
  statusStrip,
  savedTargets,
  headerActions,
}: NetworkToolScaffoldProps) {
  const status = useBackendStore((s) => s.status)
  const retry = useBackendStore((s) => s.retry)
  const refresh = useBackendStore((s) => s.refresh)
  const capability = useBackendStore((s) => s.capabilities?.capabilities[toolId])
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    if (status === 'unknown') void refresh()
  }, [status, refresh])

  async function handleRetry() {
    setRetrying(true)
    try {
      await retry()
    } finally {
      setRetrying(false)
    }
  }

  const backendDown = status === 'unavailable' || (retrying && status === 'connecting')
  const notImplemented = !backendDown && capability !== undefined && !capability.available &&
    capability.reason === 'not implemented yet'

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-5">
        <h1 className="text-[17px] font-semibold tracking-tight">{title}</h1>
        <div className="flex-1" />
        {headerActions}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-auto p-5">
            {backendDown ? (
              <BackendUnavailable onRetry={() => void handleRetry()} retrying={retrying} />
            ) : notImplemented ? (
              <div className="mx-auto max-w-md py-16 text-center text-sm text-muted-foreground">
                This tool isn&apos;t wired to the backend yet.
              </div>
            ) : (
              <>
                {queryBar}
                {results}
              </>
            )}
          </div>
          {statusStrip}
        </div>

        {savedTargets ? (
          <aside className={cn('w-60 shrink-0 overflow-auto border-l border-border/60 bg-card')}>{savedTargets}</aside>
        ) : null}
      </div>
    </div>
  )
}
