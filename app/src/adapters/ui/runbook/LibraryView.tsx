import { Pencil, Play, Trash2, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createRunbook } from '@/adapters/backend/runbookClient'
import { currentSpec, EXECUTOR_LABEL, type Runbook, type RunbookSpec } from '@/core/runbook/runbookModel'
import { useRunbookStore } from '@/stores/runbookStore'
import { RunSetupDialog } from './RunSetupDialog'

export function LibraryView() {
  const runbooks = useRunbookStore((s) => s.runbooks)
  const error = useRunbookStore((s) => s.error)
  const remove = useRunbookStore((s) => s.remove)
  const setPublished = useRunbookStore((s) => s.setPublished)
  const refresh = useRunbookStore((s) => s.refresh)
  const [query, setQuery] = useState('')
  const [runTarget, setRunTarget] = useState<Runbook | null>(null)
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const parsed = JSON.parse(await f.text()) as { spec?: RunbookSpec }
      if (!parsed.spec?.name || !Array.isArray(parsed.spec.steps)) throw new Error('not a runbook export')
      await createRunbook(parsed.spec)
      await refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'import failed')
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return runbooks
    return runbooks.filter((rb) => {
      const spec = currentSpec(rb)
      return (
        spec?.name.toLowerCase().includes(q) ||
        spec?.tags.some((t) => t.includes(q)) ||
        spec?.steps.some((st) => st.script.toLowerCase().includes(q))
      )
    })
  }, [runbooks, query])

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search runbooks"
          className="h-9 max-w-sm"
        />
        <span className="text-xs text-muted-foreground">{shown.length} runbook{shown.length === 1 ? '' : 's'}</span>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload className="size-3.5" /> Import runbook
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onImportFile} />
      </div>

      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {shown.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No runbooks yet. Press <span className="font-medium">New runbook</span> to create one.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((rb) => {
            const spec = currentSpec(rb)
            if (!spec) return null
            const first = spec.steps[0]
            return (
              <div key={rb.id} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-4">
                <div className="flex items-center gap-2">
                  <Badge variant={rb.published ? 'default' : 'outline'} className="text-[10px]">
                    {rb.published ? 'published' : 'draft'}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {first ? EXECUTOR_LABEL[first.executor] : '—'}
                  </Badge>
                  {spec.steps.length > 1 && (
                    <span className="text-[10px] text-muted-foreground">{spec.steps.length} steps</span>
                  )}
                </div>
                <p className="text-sm font-semibold">{spec.name}</p>
                {spec.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{spec.description}</p>
                )}
                <pre className="max-h-16 overflow-hidden rounded-md border border-border/50 bg-background px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                  {first?.script || '(no script)'}
                </pre>
                <div className="flex flex-wrap gap-1">
                  {spec.args.map((a) => (
                    <span key={a.name} className="rounded bg-primary/10 px-1.5 text-[10px] text-primary">
                      {a.name}
                    </span>
                  ))}
                </div>
                <div className="flex-1" />
                <div className="flex items-center gap-1.5">
                  <Button size="sm" className="flex-1" onClick={() => setRunTarget(rb)}>
                    <Play className="size-3.5" /> Run
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/tools/runbook/edit/${rb.id}`)}
                  >
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void setPublished(rb.id, !rb.published)}
                  >
                    {rb.published ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete runbook"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void remove(rb.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {runTarget && (
        <RunSetupDialog runbook={runTarget} open onOpenChange={(o) => !o && setRunTarget(null)} />
      )}
    </div>
  )
}
