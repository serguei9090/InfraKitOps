import { Network } from 'lucide-react'
import { useEffect, useState } from 'react'
import { listNodes } from '@/adapters/backend/runbookClient'
import type { SshNode } from '@/core/runbook/runbookModel'

export function SshNodesView() {
  const [nodes, setNodes] = useState<SshNode[]>([])
  useEffect(() => {
    listNodes().then(setNodes).catch(() => setNodes([]))
  }, [])

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Network className="size-4" /> SSH nodes are used by SSH steps (R2). Registered here so they are ready.
      </div>
      {nodes.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No nodes yet. The add/edit/test UI lands with the SSH executor in R2.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {nodes.map((n) => (
            <li key={n.id} className="rounded-lg border border-border/60 px-3 py-2 text-sm">
              <span className="font-medium">{n.name}</span>{' '}
              <span className="text-muted-foreground">
                {n.user}@{n.host}:{n.port} · {n.authKind}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
