import { useEffect } from 'react'
import { Check, ShieldQuestion, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAnsibleStore } from '@/stores/ansibleStore'

export function ApprovalsView() {
  const pending = useAnsibleStore((s) => s.pendingApprovals)
  const refresh = useAnsibleStore((s) => s.refreshApprovals)
  const approve = useAnsibleStore((s) => s.approveRun)

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 5000)
    return () => clearInterval(t)
  }, [refresh])

  return (
    <div className="p-5">
      {pending.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
          <ShieldQuestion className="size-8" />
          No runs waiting for approval.
        </div>
      ) : (
        <ul className="space-y-2">
          {pending.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3"
            >
              <ShieldQuestion className="size-4 text-amber-500" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  run #{r.id} · {r.playbook}
                </div>
                <div className="text-xs text-muted-foreground">
                  requested by {r.owner || 'someone'} · {new Date(r.startedAt).toLocaleString()}
                </div>
              </div>
              <Button size="sm" onClick={() => void approve(r.id, true)}>
                <Check className="size-4" /> Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => void approve(r.id, false)}>
                <X className="size-4" /> Deny
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
