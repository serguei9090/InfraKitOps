import { FolderOpen, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createSchemaRepository } from '@/adapters/storage/schemaRepository'
import type { SavedFormFlowTemplate } from '@/core/form_flow/schemaModel'

const repository = createSchemaRepository()

/**
 * FormFlow's "Sidebar Template Library" browser (Module 4, "Custom Saved
 * Templates") — lists every template persisted through
 * `createSchemaRepository`. "Load" navigates to the FormFlow builder route
 * passing the deserialized template via router state (`navigate(path,
 * {state})`, React Router's equivalent of go_router's `extra`). "Delete" is
 * gated behind a confirmation dialog.
 */
export function SavedTemplatesScreen() {
  const navigate = useNavigate()
  const [names, setNames] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<string | null>(null)

  function refresh() {
    setNames(null)
    repository
      .listNames()
      .then(setNames)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  useEffect(refresh, [])

  async function load(name: string) {
    const raw = await repository.load(name)
    if (raw == null) {
      refresh()
      return
    }
    const template = JSON.parse(raw) as SavedFormFlowTemplate
    navigate('/tools/formflow-builder', { state: { template } })
  }

  async function confirmDelete() {
    if (!toDelete) return
    await repository.delete(toDelete)
    setToDelete(null)
    refresh()
  }

  return (
    <div className="p-7">
      <h1 className="text-2xl font-bold tracking-tight">Saved Templates</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Templates you save from the FormFlow designer show up here.
      </p>

      <div className="mt-6">
        {error ? (
          <p className="text-sm text-destructive">Could not load saved templates: {error}</p>
        ) : names === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : names.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <FolderOpen className="size-12 text-muted-foreground" />
            <p className="text-base font-medium">No saved templates yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Templates you save from the FormFlow designer will show up here.
            </p>
            <Button variant="outline" size="sm" onClick={refresh}>
              Refresh
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {names.map((name) => (
              <div
                key={name}
                className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <FolderOpen className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate text-sm font-medium">{name}</span>
                <Button variant="ghost" size="sm" onClick={() => load(name)}>
                  Load
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete"
                  onClick={() => setToDelete(name)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete template?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            "{toDelete}" will be permanently deleted. This cannot be undone.
          </p>
          <DialogFooter>
            <DialogTrigger render={<Button variant="outline">Cancel</Button>} />
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
