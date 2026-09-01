import { useEffect } from 'react'
import { CheckCircle2, ShieldQuestion, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRunbookStore } from '@/stores/runbookStore'
import { useAuthStore } from '@/stores/authStore'

/**
 * Runs parked for a second operator (U3). Any operator+ can approve or deny a
 * run they didn't start. Empty in single-user mode.
 */
export function ApprovalsView() {
  const pending = useRunbookStore((s) => s.pendingApprovals)
  const refresh = useRunbookStore((s) => s.refreshPendingApprovals)
  const approve = useRunbookStore((s) => s.approveRun)
  const runbooks = useRunbookStore((s) => s.runbooks)
  const meId = useAuthStore((s) => s.me?.id)

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 10_000)
    return () => clearInterval(t)
  }, [refresh])

  const name = (id: string) => runbooks.find((r) => r.id === id)?.slug ?? id

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldQuestion className="size-4" />
        Runs waiting for a second operator&rsquo;s approval. You can&rsquo;t approve your own.
      </div>

      {pending.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Nothing waiting.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {pending.map((run) => {
            const mine = run.owner && run.owner === meId
            return (
              <li
                key={run.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{name(run.runbookId)}</span>{' '}
                  <span className="text-xs text-muted-foreground">
                    run #{run.id} · v{run.runbookVersion} · started {new Date(run.startedAt).toLocaleTimeString()}
                  </span>
                  {mine && <div className="text-[11px] text-muted-foreground">you started this — another operator must approve</div>}
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!!mine}
                  onClick={() => void approve(run.id, true)}
                >
                  <CheckCircle2 className="size-3.5" /> Approve
                </Button>
                <Button size="xs" variant="ghost" disabled={!!mine} onClick={() => void approve(run.id, false)}>
                  <XCircle className="size-3.5" /> Deny
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
