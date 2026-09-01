import { useState } from 'react'
import { Plug, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLlmStore } from '@/stores/llmStore'
import { PROVIDER_DEFAULT_MODEL, PROVIDER_LABEL, type LlmConnection } from '@/core/llm/llmModel'
import { ConnectionDialog } from './ConnectionDialog'

type Draft = Partial<LlmConnection>

export function ConnectionsView() {
  const connections = useLlmStore((s) => s.connections)
  const error = useLlmStore((s) => s.error)
  const removeConnection = useLlmStore((s) => s.removeConnection)
  const [editing, setEditing] = useState<Draft | null>(null)

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Plug className="size-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Endpoints the AI features talk to. Keys are stored in the Vault, never here.
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={() =>
            setEditing({ provider: 'ollama', baseUrl: '', name: '', defaultModel: PROVIDER_DEFAULT_MODEL.ollama })
          }
        >
          <Plus className="size-4" /> Connection
        </Button>
      </div>

      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {connections.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No connections yet. Add an Ollama endpoint (no key) or an OpenAI-compatible one.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {connections.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{c.name}</span>{' '}
                <Badge variant="secondary" className="text-[10px]">
                  {PROVIDER_LABEL[c.provider] ?? c.provider}
                </Badge>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {c.baseUrl || 'default endpoint'}
                  {c.defaultModel && <> · {c.defaultModel}</>}
                  {c.authSecretId && <> · keyed</>}
                </div>
              </div>
              <Button size="xs" variant="ghost" onClick={() => setEditing(c)}>
                Edit
              </Button>
              <button
                type="button"
                aria-label={`Delete ${c.name}`}
                onClick={() => void removeConnection(c.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConnectionDialog
        key={editing?.id ?? (editing ? 'new' : 'closed')}
        draft={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}
