import { useEffect, useState } from 'react'
import { listRuns } from '@/adapters/backend/runbookClient'
import { useRunbookStore } from '@/stores/runbookStore'
import { currentSpec, type Run } from '@/core/runbook/runbookModel'
import { cn } from '@/lib/utils'

export function HistoryView() {
  const runbooks = useRunbookStore((s) => s.runbooks)
  const [runs, setRuns] = useState<Run[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    listRuns(undefined, 200).then(setRuns).catch((e) => setErr(String(e)))
  }, [])

  function nameOf(id: string) {
    const rb = runbooks.find((r) => r.id === id)
    return rb ? currentSpec(rb)?.name ?? rb.slug : id
  }

  return (
    <div className="p-5">
      {err && <p className="text-sm text-destructive">{err}</p>}
      {runs.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No runs yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {runs.map((run) => (
            <li key={run.id} className="rounded-lg border border-border/60">
              <button
                type="button"
                onClick={() => setOpen((o) => (o === run.id ? null : run.id))}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent/40"
              >
                <span
                  className={cn(
                    'size-2 rounded-full',
                    run.status === 'ok' && 'bg-emerald-500',
                    run.status === 'failed' && 'bg-destructive',
                    run.status === 'partial' && 'bg-amber-500',
                    run.status === 'running' && 'bg-primary',
                  )}
                />
                <span className="font-medium">{nameOf(run.runbookId)}</span>
                <span className="text-xs text-muted-foreground">v{run.runbookVersion}</span>
                {run.dryRun && <span className="text-[10px] text-muted-foreground">dry run</span>}
                <div className="flex-1" />
                <span className="text-xs text-muted-foreground">
                  {new Date(run.startedAt).toLocaleString()}
                </span>
              </button>
              {open === run.id && (
                <div className="border-t border-border/60 p-3">
                  {run.steps.map((st) => (
                    <div key={st.index} className="mb-2">
                      <p className="text-xs font-medium">
                        {st.index}. {st.name}{' '}
                        <span className="text-muted-foreground">· {st.executor} · exit {st.exitCode} · {st.status}</span>
                      </p>
                      <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-background px-2 py-1 font-mono text-[11px]">
                        {`$ ${st.commandRedacted}\n${st.stdout}${st.stderr ? `\n${st.stderr}` : ''}`}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
