import { lazy, Suspense, useEffect, useState } from 'react'
import { Boxes, Download, FolderGit2, Loader2, PackageCheck, Save, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import * as api from '@/adapters/backend/ansibleClient'
import { useAnsibleStore } from '@/stores/ansibleStore'

const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })))

export function ContentView() {
  const selectedId = useAnsibleStore((s) => s.selectedId)
  const tree = useAnsibleStore((s) => s.tree)
  const galaxyBusy = useAnsibleStore((s) => s.galaxyBusy)
  const galaxyLog = useAnsibleStore((s) => s.galaxyLog)
  const install = useAnsibleStore((s) => s.galaxyInstall)

  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a project on the Projects tab first
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 gap-4 p-5 lg:grid-cols-2">
      <div className="flex min-h-0 flex-col gap-3">
        <Requirements projectId={selectedId} />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => install({})} disabled={galaxyBusy}>
            {galaxyBusy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Install from requirements.yml
          </Button>
        </div>
        {galaxyLog.length > 0 && (
          <pre className="max-h-40 shrink-0 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">
            {galaxyLog.join('\n')}
          </pre>
        )}

        <div className="rounded-lg border border-border/60 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
            <PackageCheck className="size-3.5" /> Installed
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="mb-0.5 font-medium">Roles ({tree?.roles.length ?? 0})</div>
              {(tree?.roles ?? []).map((r) => (
                <div key={r} className="flex items-center gap-1 font-mono text-muted-foreground">
                  <FolderGit2 className="size-3" /> {r}
                </div>
              ))}
            </div>
            <div>
              <div className="mb-0.5 font-medium">Collections ({tree?.collections.length ?? 0})</div>
              {(tree?.collections ?? []).map((c) => (
                <div key={c} className="flex items-center gap-1 font-mono text-muted-foreground">
                  <Boxes className="size-3" /> {c}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <GalaxySearch busy={galaxyBusy} onInstall={(item) => install({ type: item.type, name: item.name })} />
    </div>
  )
}

function Requirements({ projectId }: { projectId: string }) {
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const reloadTree = useAnsibleStore((s) => s.select)

  useEffect(() => {
    api
      .readProjectFile(projectId, 'requirements.yml')
      .then((r) => setContent(r.content))
      .catch(() => setContent('---\nroles: []\ncollections: []\n'))
      .finally(() => setLoaded(true))
  }, [projectId])

  return (
    <div className="flex min-h-40 flex-1 flex-col rounded-lg border border-border/60">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <span className="font-mono text-xs">requirements.yml</span>
        <Button
          size="sm"
          onClick={async () => {
            await api.writeProjectFile(projectId, 'requirements.yml', content)
            setDirty(false)
            void reloadTree(projectId)
          }}
          disabled={!dirty}
        >
          <Save className="size-4" /> Save
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {loaded && (
          <Suspense fallback={<div className="h-full bg-muted/20" />}>
            <CodeEditor
              value={content}
              onChange={(v) => {
                setContent(v)
                setDirty(true)
              }}
            />
          </Suspense>
        )}
      </div>
    </div>
  )
}

function GalaxySearch({
  busy,
  onInstall,
}: {
  busy: boolean
  onInstall: (item: api.GalaxyItem) => void
}) {
  const [q, setQ] = useState('')
  const [type, setType] = useState<'' | 'role' | 'collection'>('collection')
  const [items, setItems] = useState<api.GalaxyItem[]>([])
  const [searching, setSearching] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function search(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    setSearching(true)
    setErr(null)
    try {
      setItems(await api.galaxySearch(type, q.trim()))
    } catch (e) {
      setItems([])
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-border/60">
      <div className="border-b border-border/60 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
          <Search className="size-3.5" /> Ansible Galaxy
        </div>
        <div className="mb-2 flex gap-1">
          {(['collection', 'role', ''] as const).map((t) => (
            <button
              key={t || 'both'}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                'rounded px-2 py-0.5 text-xs',
                type === t ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:bg-accent/40',
              )}
            >
              {t || 'both'}
            </button>
          ))}
        </div>
        <form onSubmit={search} className="flex gap-1.5">
          <Input
            className="h-8 text-xs"
            placeholder="nginx, community.docker, …"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button size="sm" type="submit" disabled={searching}>
            {searching ? <Loader2 className="size-4 animate-spin" /> : 'Search'}
          </Button>
        </form>
        {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
      </div>
      <div className="min-h-0 flex-1 divide-y divide-border/40 overflow-auto">
        {items.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No results yet.</p>
        ) : (
          items.map((it) => (
            <div key={`${it.type}:${it.name}`} className="flex items-start gap-2 p-2.5">
              <span
                className={cn(
                  'mt-0.5 shrink-0 rounded px-1 text-[9px] font-semibold uppercase',
                  it.type === 'collection'
                    ? 'bg-indigo-500/15 text-indigo-500'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                )}
              >
                {it.type[0]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs font-medium">
                  {it.name}
                  {it.version ? <span className="text-muted-foreground"> v{it.version}</span> : null}
                </div>
                {it.description && (
                  <div className="line-clamp-2 text-xs text-muted-foreground">{it.description}</div>
                )}
              </div>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onInstall(it)}>
                <Download className="size-3.5" /> Install
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
