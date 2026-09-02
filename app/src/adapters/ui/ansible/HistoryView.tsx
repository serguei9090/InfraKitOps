import { useEffect } from 'react'
import { CheckCircle2, CircleSlash, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAnsibleStore } from '@/stores/ansibleStore'
import type { RunStatus } from '@/core/ansible/ansibleModel'

const ICON: Record<RunStatus, { node: React.ReactNode }> = {
  ok: { node: <CheckCircle2 className="size-4 text-emerald-500" /> },
  running: { node: <CircleSlash className="size-4 text-muted-foreground" /> },
  failed: { node: <XCircle className="size-4 text-red-500" /> },
  unreachable: { node: <XCircle className="size-4 text-fuchsia-500" /> },
  cancelled: { node: <CircleSlash className="size-4 text-amber-500" /> },
}

export function HistoryView() {
  const runs = useAnsibleStore((s) => s.runs)
  const selectedId = useAnsibleStore((s) => s.selectedId)
  const refreshRuns = useAnsibleStore((s) => s.refreshRuns)

  useEffect(() => {
    void refreshRuns()
  }, [refreshRuns, selectedId])

  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a project to see its run history
      </div>
    )
  }

  return (
    <div className="p-5">
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runs yet for this project.</p>
      ) : (
        <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
          {runs.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {ICON[r.status]?.node}
              <span className="font-mono text-xs">#{r.id}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{r.playbook}</span>
              <span className={cn('text-xs', r.status === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                {r.status}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(r.startedAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
