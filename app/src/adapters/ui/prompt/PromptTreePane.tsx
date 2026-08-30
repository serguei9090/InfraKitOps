import { ChevronRight, FilePlus2, FolderPlus, MoreHorizontal, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { currentMessages, isDirty, type Folder, type Prompt } from '@/core/prompt/promptModel'
import { usePromptLibraryStore } from '@/stores/promptLibraryStore'
import { cn } from '@/lib/utils'
import { NewPromptDialog } from './NewPromptDialog'

const UNFILED = '__unfiled__'

function matches(prompt: Prompt, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  if (prompt.name.toLowerCase().includes(q)) return true
  if (prompt.tags.some((t) => t.includes(q))) return true
  return currentMessages(prompt).some((m) => m.content.toLowerCase().includes(q))
}

export function PromptTreePane() {
  const folders = usePromptLibraryStore((s) => s.folders)
  const prompts = usePromptLibraryStore((s) => s.prompts)
  const selectedPromptId = usePromptLibraryStore((s) => s.selectedPromptId)
  const selectPrompt = usePromptLibraryStore((s) => s.selectPrompt)
  const deletePrompt = usePromptLibraryStore((s) => s.deletePrompt)
  const createFolder = usePromptLibraryStore((s) => s.createFolder)
  const renameFolder = usePromptLibraryStore((s) => s.renameFolder)
  const deleteFolder = usePromptLibraryStore((s) => s.deleteFolder)

  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renaming, setRenaming] = useState<Folder | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  // `undefined` = closed; `null` / string = open, targeting that folder.
  const [newPromptFolder, setNewPromptFolder] = useState<string | null | undefined>(undefined)

  const allTags = useMemo(
    () => [...new Set(prompts.flatMap((p) => p.tags))].sort(),
    [prompts],
  )

  const visible = useMemo(
    () => prompts.filter((p) => matches(p, query) && (!activeTag || p.tags.includes(activeTag))),
    [prompts, query, activeTag],
  )

  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.name.localeCompare(b.name)),
    [folders],
  )

  const groups: { key: string; label: string; folder: Folder | null; items: Prompt[] }[] = [
    ...sortedFolders.map((f) => ({
      key: f.id,
      label: f.name,
      folder: f,
      items: visible.filter((p) => p.folderId === f.id).sort((a, b) => a.name.localeCompare(b.name)),
    })),
    {
      key: UNFILED,
      label: 'Unfiled',
      folder: null,
      items: visible.filter((p) => p.folderId == null).sort((a, b) => a.name.localeCompare(b.name)),
    },
  ]

  function confirmNewFolder() {
    const name = newFolderName.trim()
    if (!name) return
    createFolder(name)
    setNewFolderName('')
    setNewFolderOpen(false)
  }

  function confirmRename() {
    if (renaming && renameValue.trim()) renameFolder(renaming.id, renameValue.trim())
    setRenaming(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border/60 p-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search prompts"
            className="h-8 pl-8 text-sm"
          />
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag((t) => (t === tag ? null : tag))}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px]',
                  activeTag === tag
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1.5">
          <Button size="xs" variant="outline" className="flex-1" onClick={() => setNewPromptFolder(null)}>
            <FilePlus2 className="size-3.5" /> Prompt
          </Button>
          <Button size="xs" variant="outline" className="flex-1" onClick={() => setNewFolderOpen(true)}>
            <FolderPlus className="size-3.5" /> Folder
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {groups.map((g) => {
          if (g.folder == null && g.items.length === 0) return null
          const isCollapsed = collapsed[g.key]
          return (
            <div key={g.key} className="mb-1">
              <div className="group flex items-center gap-1 px-1 py-1 text-xs font-medium text-muted-foreground">
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                  className="flex flex-1 items-center gap-1 hover:text-foreground"
                >
                  <ChevronRight className={cn('size-3 transition-transform', !isCollapsed && 'rotate-90')} />
                  {g.label}
                  <span className="text-muted-foreground/60">{g.items.length}</span>
                </button>
                {g.folder && (
                  <>
                    <button
                      type="button"
                      aria-label={`New prompt in ${g.label}`}
                      onClick={() => setNewPromptFolder(g.folder!.id)}
                      className="hidden text-muted-foreground hover:text-foreground group-hover:block"
                    >
                      <FilePlus2 className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Folder options for ${g.label}`}
                      onClick={() => {
                        setRenaming(g.folder!)
                        setRenameValue(g.folder!.name)
                      }}
                      className="hidden text-muted-foreground hover:text-foreground group-hover:block"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  </>
                )}
              </div>

              {!isCollapsed && (
                <ul className="flex flex-col gap-0.5">
                  {g.items.map((p) => (
                    <li
                      key={p.id}
                      className={cn(
                        'group flex items-center gap-1 rounded-md px-2 py-1 text-sm',
                        p.id === selectedPromptId ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => selectPrompt(p.id)}
                        className="min-w-0 flex-1 truncate text-left"
                        title={p.name}
                      >
                        {p.name}
                        {isDirty(p) && <span className="ml-1 text-muted-foreground">•</span>}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${p.name}`}
                        onClick={() => deletePrompt(p.id)}
                        className="hidden shrink-0 text-muted-foreground hover:text-destructive group-hover:block"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                  {g.items.length === 0 && (
                    <li className="px-2 py-1 text-xs text-muted-foreground/70">empty</li>
                  )}
                </ul>
              )}
            </div>
          )
        })}
        {prompts.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            No prompts yet. Press <span className="font-medium">Prompt</span> to create one.
          </p>
        )}
      </div>

      {/* New folder */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-folder">Name</Label>
            <Input
              id="new-folder"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmNewFolder()}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button onClick={confirmNewFolder} disabled={!newFolderName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename / delete folder */}
      <Dialog open={renaming != null} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Folder: {renaming?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rename-folder">Name</Label>
            <Input
              id="rename-folder"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
            />
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              variant="destructive"
              onClick={() => {
                setDeletingFolder(renaming)
                setRenaming(null)
              }}
            >
              Delete folder
            </Button>
            <div className="flex gap-2">
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <Button onClick={confirmRename} disabled={!renameValue.trim()}>
                Rename
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deletingFolder != null} onOpenChange={(o) => !o && setDeletingFolder(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{deletingFolder?.name}”?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            What should happen to the prompts inside it?
          </p>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                if (deletingFolder) deleteFolder(deletingFolder.id, 'unfiled')
                setDeletingFolder(null)
              }}
            >
              Move prompts to Unfiled
            </Button>
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => {
                if (deletingFolder) deleteFolder(deletingFolder.id, 'delete')
                setDeletingFolder(null)
              }}
            >
              Delete folder and its prompts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewPromptDialog
        open={newPromptFolder !== undefined}
        onOpenChange={(o) => !o && setNewPromptFolder(undefined)}
        folderId={newPromptFolder ?? null}
      />
    </div>
  )
}
