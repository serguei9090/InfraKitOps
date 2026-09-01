import { CheckCircle2, Loader2, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRunbookStore } from '@/stores/runbookStore'
import { InlineError } from '@/adapters/ui/errors/InlineError'
import { cn } from '@/lib/utils'

/**
 * Bottom-docked live-run panel. Shows per-step status + streamed output while a
 * run is in flight, and stays until dismissed so the result is readable.
 */
export function RunPanel() {
  const live = useRunbookStore((s) => s.live)
  const clearLive = useRunbookStore((s) => s.clearLive)
  const approveRun = useRunbookStore((s) => s.approveRun)
  if (!live) return null

  const done = live.status === 'ok' || live.status === 'failed' || live.status === 'partial' || live.status === 'error'
  const waiting = live.status === 'awaiting_approval'

  return (
    <div className="absolute inset-x-0 bottom-8 z-20 mx-auto max-h-[55%] w-[min(900px,calc(100%-2rem))] overflow-hidden rounded-xl border border-border/60 bg-popover shadow-2xl">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
        {live.status === 'error' || live.status === 'failed' ? (
          <XCircle className="size-4 text-destructive" />
        ) : done ? (
          <CheckCircle2 className="size-4 text-emerald-500" />
        ) : (
          <Loader2 className="size-4 animate-spin text-primary" />
        )}
        <span className="text-sm font-medium">
          {live.status === 'starting' && 'Starting…'}
          {live.status === 'awaiting_approval' && 'Waiting for approval'}
          {live.status === 'running' && `Running (${live.steps.length} step${live.steps.length === 1 ? '' : 's'})`}
          {live.status === 'ok' && 'Completed'}
          {live.status === 'partial' && 'Completed with errors'}
          {live.status === 'failed' && 'Failed'}
          {live.status === 'error' && (live.error || 'Error')}
        </span>
        {live.runId != null && <span className="text-xs text-muted-foreground">run #{live.runId}</span>}
        <div className="flex-1" />
        {waiting && live.runId != null && (
          <>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void approveRun(live.runId!, true)}
              title="If you started this run, another operator must approve it"
            >
              Approve
            </Button>
            <Button size="xs" variant="ghost" onClick={() => void approveRun(live.runId!, false)}>
              Deny
            </Button>
          </>
        )}
        {!done && (
          <Button size="xs" variant="outline" onClick={() => live.abort()}>
            Stop
          </Button>
        )}
        <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={clearLive}>
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="max-h-[calc(55vh-3rem)] overflow-y-auto p-3">
        {live.steps.length === 0 && live.errorObj && (
          <InlineError error={live.errorObj} />
        )}
        {live.steps.length === 0 && !live.errorObj && live.error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
            {live.error}
          </p>
        )}
        {live.steps.map((st) => {
          const stepLog = live.log.filter((l) => l.stepIndex === st.index)
          return (
            <div key={st.index} className="mb-2 rounded-lg border border-border/60">
              <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5 text-xs">
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    st.status === 'ok' && 'bg-emerald-500',
                    st.status === 'failed' && 'bg-destructive',
                    st.status === 'running' && 'bg-primary animate-pulse',
                    st.status === 'skipped' && 'bg-muted-foreground/40',
                  )}
                />
                <span className="font-medium">
                  {st.index}. {st.name}
                </span>
                <span className="text-muted-foreground">· {st.executor}</span>
                {st.status !== 'running' && st.exitCode !== 0 && (
                  <span className="text-destructive">exit {st.exitCode}</span>
                )}
                <div className="flex-1" />
                <span className="text-muted-foreground">{st.status}</span>
              </div>
              {st.commandRedacted && (
                <pre className="border-b border-border/40 bg-background/50 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                  $ {st.commandRedacted}
                </pre>
              )}
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-2.5 py-1.5 font-mono text-[12px]">
                {(st.stdout || st.stderr)
                  ? `${st.stdout}${st.stderr ? `\n${st.stderr}` : ''}`
                  : stepLog.map((l) => l.text).join('') || '…'}
              </pre>
            </div>
          )
        })}
      </div>
    </div>
  )
}
