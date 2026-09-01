import { useEffect, useState } from 'react'
import { Boxes, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useMcpStore } from '@/stores/mcpStore'
import { emptyServer, type McpServer } from '@/core/mcp/mcpModel'
import { McpServerDialog } from './McpServerDialog'

type Draft = Partial<McpServer>

export function McpView() {
  const servers = useMcpStore((s) => s.servers)
  const loaded = useMcpStore((s) => s.loaded)
  const refresh = useMcpStore((s) => s.refresh)
  const removeServer = useMcpStore((s) => s.removeServer)
  const [editing, setEditing] = useState<Draft | null>(null)

  useEffect(() => {
    if (!loaded) void refresh()
  }, [loaded, refresh])

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Boxes className="size-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Tool servers the model can call — docs lookup, web search, filesystem. Read-only tools run
          automatically; others ask first.
        </span>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setEditing(emptyServer('stdio'))}>
          <Plus className="size-4" /> Server
        </Button>
      </div>

      {servers.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No MCP servers yet. Add one (e.g. <code className="font-mono">npx -y @upstash/context7-mcp</code>) so the
          model can look up things it wasn&rsquo;t trained on.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {servers.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{s.name}</span>{' '}
                <Badge variant="secondary" className="text-[10px]">
                  {s.transport}
                </Badge>
                {!s.enabled && (
                  <Badge variant="outline" className="ml-1 text-[10px]">
                    disabled
                  </Badge>
                )}
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {s.transport === 'stdio' ? [s.command, ...(s.args ?? [])].join(' ') : s.url}
                </div>
              </div>
              <Button size="xs" variant="ghost" onClick={() => setEditing(s)}>
                Edit
              </Button>
              <button
                type="button"
                aria-label={`Delete ${s.name}`}
                onClick={() => void removeServer(s.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <McpServerDialog
        key={editing?.id ?? (editing ? 'new' : 'closed')}
        draft={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}
