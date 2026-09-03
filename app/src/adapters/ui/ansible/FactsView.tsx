import { useEffect, useState } from 'react'
import { ChevronRight, Loader2, RefreshCw, Search, ServerCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useAnsibleStore } from '@/stores/ansibleStore'

export function FactsView() {
  const selectedId = useAnsibleStore((s) => s.selectedId)
  const facts = useAnsibleStore((s) => s.facts)
  const busy = useAnsibleStore((s) => s.factsBusy)
  const refresh = useAnsibleStore((s) => s.refreshFacts)
  const gather = useAnsibleStore((s) => s.gatherFacts)

  const [host, setHost] = useState('')
  const [pattern, setPattern] = useState('all')
  const [q, setQ] = useState('')

  useEffect(() => {
    void refresh()
  }, [refresh, selectedId])

  const current = facts.find((f) => f.host === (host || facts[0]?.host))

  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a project on the Projects tab first
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border/60">
        <div className="space-y-2 border-b border-border/60 p-3">
          <div className="flex gap-1.5">
            <Input
              className="h-8 text-xs"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="host pattern"
            />
            <Button size="sm" disabled={busy} onClick={() => void gather(pattern)}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : 'Gather'}
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="w-full" onClick={() => void refresh()}>
            <RefreshCw className="size-3.5" /> Reload cache
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {facts.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              No cached facts. Run a playbook (facts are gathered + cached) or “Gather” above.
            </p>
          ) : (
            facts.map((f) => (
              <button
                key={f.host}
                type="button"
                onClick={() => setHost(f.host)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                  f.host === current?.host ? 'bg-primary/10 text-primary' : 'hover:bg-accent/40',
                )}
              >
                <ServerCog className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{f.host}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-auto p-4">
        {!current ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No host selected
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <span className="font-mono text-sm font-medium">{current.host}</span>
              <span className="text-xs text-muted-foreground">
                {current.gatheredAt ? new Date(current.gatheredAt).toLocaleString() : ''}
              </span>
              <div className="flex-1" />
              <div className="relative">
                <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 w-48 pl-7 text-xs"
                  placeholder="filter keys"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
            <FactTree value={current.facts} filter={q.toLowerCase()} path="" depth={0} />
          </>
        )}
      </section>
    </div>
  )
}

function FactTree({
  value,
  filter,
  path,
  depth,
}: {
  value: unknown
  filter: string
  path: string
  depth: number
}) {
  if (value === null || typeof value !== 'object') {
    return (
      <span className="font-mono text-xs">
        {typeof value === 'string' ? `"${value}"` : String(value)}
      </span>
    )
  }
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>)

  return (
    <ul className={cn(depth > 0 && 'ml-4 border-l border-border/40 pl-2')}>
      {entries.map(([k, v]) => {
        const childPath = path ? `${path}.${k}` : k
        const isObj = v !== null && typeof v === 'object'
        const matchHere = !filter || childPath.toLowerCase().includes(filter)
        const showSubtree = matchHere || (isObj && subtreeMatches(v, filter))
        if (filter && !showSubtree) return null
        return (
          <li key={k} className="py-0.5">
            {isObj ? (
              <details open={depth < 1 || !!filter}>
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="mr-1 inline size-3 opacity-60" />
                  <span className="font-mono text-xs font-medium text-primary">{k}</span>
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {Array.isArray(v) ? `[${(v as unknown[]).length}]` : `{${Object.keys(v as object).length}}`}
                  </span>
                </summary>
                <FactTree value={v} filter={filter} path={childPath} depth={depth + 1} />
              </details>
            ) : (
              <div>
                <span className="font-mono text-xs font-medium text-primary">{k}</span>
                <span className="mx-1 text-muted-foreground">:</span>
                <span className="font-mono text-xs">
                  {typeof v === 'string' ? `"${v}"` : String(v)}
                </span>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function subtreeMatches(v: unknown, filter: string): boolean {
  if (!filter) return true
  if (v === null || typeof v !== 'object') return false
  return Object.entries(v as Record<string, unknown>).some(
    ([k, child]) => k.toLowerCase().includes(filter) || subtreeMatches(child, filter),
  )
}
