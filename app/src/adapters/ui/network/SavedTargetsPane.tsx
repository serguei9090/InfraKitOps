import { ChevronRight, FolderOpen, Plus, Star, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSavedTargetsRepository, type SavedTarget } from '@/adapters/storage/savedTargetsRepository'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const repo = createSavedTargetsRepository()

interface SavedTargetsPaneProps {
  tool: string
  /** Current params to offer for saving; null hides the "save current" action. */
  currentParams: Record<string, unknown> | null
  /** Short human label for the current query (used as the default save name). */
  currentLabel?: string
  /** Load a saved target's params back into the tool. */
  onLoad: (params: Record<string, unknown>) => void
}

/**
 * Right-hand pane for the T4 Network Console: the tool's saved queries, grouped
 * by folder. Backed by IStoragePort. See NETWORK_MODULE_PLAN.md §3.
 */
export function SavedTargetsPane({ tool, currentParams, currentLabel, onLoad }: SavedTargetsPaneProps) {
  const [items, setItems] = useState<SavedTarget[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveLabel, setSaveLabel] = useState('')
  const [saveFolder, setSaveFolder] = useState('')

  const refresh = useCallback(() => {
    repo.list(tool).then(setItems)
  }, [tool])

  useEffect(refresh, [refresh])

  const groups = useMemo(() => {
    const byFolder = new Map<string, SavedTarget[]>()
    for (const it of items) {
      const key = it.folder || ''
      if (!byFolder.has(key)) byFolder.set(key, [])
      byFolder.get(key)!.push(it)
    }
    return [...byFolder.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  }, [items])

  async function confirmSave() {
    if (!currentParams || !saveLabel.trim()) return
    await repo.add({ tool, label: saveLabel.trim(), folder: saveFolder.trim(), params: currentParams })
    setSaveOpen(false)
    setSaveLabel('')
    setSaveFolder('')
    refresh()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saved targets</span>
        {currentParams ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Save current query"
            onClick={() => {
              setSaveLabel(currentLabel ?? '')
              setSaveOpen(true)
            }}
          >
            <Plus className="size-3.5" />
          </Button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No saved targets. Run a query and press + to save it.
          </p>
        ) : (
          groups.map(([folder, entries]) => (
            <div key={folder || '__ungrouped'} className="mb-1">
              {folder ? (
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [folder]: !c[folder] }))}
                  className="flex w-full items-center gap-1 px-1.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight className={cn('size-3 transition-transform', !collapsed[folder] && 'rotate-90')} />
                  <FolderOpen className="size-3" />
                  {folder}
                </button>
              ) : null}
              {folder && collapsed[folder] ? null : (
                <ul className="flex flex-col gap-0.5">
                  {entries.map((it) => (
                    <li
                      key={it.id}
                      className="group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm hover:bg-accent/40"
                    >
                      <Star className="size-3 shrink-0 text-muted-foreground" />
                      <button
                        type="button"
                        onClick={() => onLoad(it.params)}
                        className="min-w-0 flex-1 truncate text-left"
                        title={it.label}
                      >
                        {it.label}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${it.label}`}
                        onClick={async () => {
                          await repo.remove(it.id)
                          refresh()
                        }}
                        className="hidden shrink-0 text-muted-foreground hover:text-destructive group-hover:block"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save target</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-label">Name</Label>
              <Input
                id="st-label"
                value={saveLabel}
                onChange={(e) => setSaveLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveLabel.trim() && confirmSave()}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-folder">Folder (optional)</Label>
              <Input
                id="st-folder"
                value={saveFolder}
                onChange={(e) => setSaveFolder(e.target.value)}
                placeholder="e.g. Production"
                list="saved-target-folders"
              />
              <datalist id="saved-target-folders">
                {[...new Set(items.map((i) => i.folder).filter(Boolean))].map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button onClick={confirmSave} disabled={!saveLabel.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
