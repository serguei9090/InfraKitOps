import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ChevronRight,
  Download,
  FilePlus2,
  FolderPlus,
  MoreHorizontal,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { type ChangeEvent, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { currentMessages, isDirty, type Folder, type Prompt } from '@/core/prompt/promptModel'
import { exportPrompts } from '@/core/prompt/promptIo'
import { usePromptLibraryStore } from '@/stores/promptLibraryStore'
import { downloadBlob } from '@/lib/downloadFile'
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
  const moveToFolder = usePromptLibraryStore((s) => s.moveToFolder)
  const reorderInFolder = usePromptLibraryStore((s) => s.reorderInFolder)
  const importFromJson = usePromptLibraryStore((s) => s.importFromJson)

  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renaming, setRenaming] = useState<Folder | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  const [newPromptFolder, setNewPromptFolder] = useState<string | null | undefined>(undefined)
  const [importMsg, setImportMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const allTags = useMemo(() => [...new Set(prompts.flatMap((p) => p.tags))].sort(), [prompts])

  const visible = useMemo(
    () => prompts.filter((p) => matches(p, query) && (!activeTag || p.tags.includes(activeTag))),
    [prompts, query, activeTag],
  )

  const groups = useMemo(() => {
    const byOrder = (a: Prompt, b: Prompt) => a.order - b.order
    const sortedFolders = [...folders].sort((a, b) => a.name.localeCompare(b.name))
    return [
      ...sortedFolders.map((f) => ({
        key: f.id,
        label: f.name,
        folder: f,
        items: visible.filter((p) => p.folderId === f.id).sort(byOrder),
      })),
      {
        key: UNFILED,
        label: 'Unfiled',
        folder: null,
        items: visible.filter((p) => p.folderId == null).sort(byOrder),
      },
    ]
  }, [folders, visible])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const dragged = prompts.find((p) => p.id === activeId)
    if (!dragged) return

    // Dropped on a folder header droppable.
    if (String(over.id).startsWith('drop:')) {
      const target = String(over.id).slice('drop:'.length)
      const targetFolderId = target === UNFILED ? null : target
      if (dragged.folderId !== targetFolderId) moveToFolder(activeId, targetFolderId)
      return
    }

    // Dropped on another prompt — adopt its folder and slot in at its position.
    const overPrompt = prompts.find((p) => p.id === String(over.id))
    if (!overPrompt || overPrompt.id === activeId) return
    const targetFolderId = overPrompt.folderId
    const list = prompts
      .filter((p) => p.folderId === targetFolderId && p.id !== activeId)
      .sort((a, b) => a.order - b.order)
      .map((p) => p.id)
    const insertAt = list.indexOf(overPrompt.id)
    list.splice(insertAt, 0, activeId)
    if (dragged.folderId !== targetFolderId) moveToFolder(activeId, targetFolderId)
    reorderInFolder(targetFolderId, list)
  }

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

  function exportOne(p: Prompt) {
    downloadBlob(
      exportPrompts([p], folders),
      `${p.name.replace(/[^\w-]+/g, '_') || 'prompt'}.json`,
      'application/json',
    )
  }

  function exportAll() {
    downloadBlob(exportPrompts(prompts, folders), 'prompt-library.json', 'application/json')
  }

  async function onImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const { added } = importFromJson(await file.text())
      setImportMsg({ kind: 'ok', text: `Imported ${added} prompt${added === 1 ? '' : 's'}.` })
    } catch (err) {
      setImportMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Import failed.' })
    }
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          {groups.map((g) => {
            if (g.folder == null && g.items.length === 0) return null
            return (
              <FolderGroup
                key={g.key}
                group={g}
                collapsed={!!collapsed[g.key]}
                selectedPromptId={selectedPromptId}
                onToggleCollapse={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                onNewPrompt={() => g.folder && setNewPromptFolder(g.folder.id)}
                onFolderOptions={() => {
                  if (!g.folder) return
                  setRenaming(g.folder)
                  setRenameValue(g.folder.name)
                }}
                onSelect={selectPrompt}
                onDelete={deletePrompt}
                onExport={exportOne}
              />
            )
          })}
        </DndContext>
        {prompts.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            No prompts yet. Press <span className="font-medium">Prompt</span> to create one.
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-border/60 p-2">
        <Button size="xs" variant="ghost" className="flex-1" onClick={() => fileInputRef.current?.click()}>
          <Upload className="size-3.5" /> Import
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="flex-1"
          disabled={prompts.length === 0}
          onClick={exportAll}
        >
          <Download className="size-3.5" /> Export all
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={onImportFile}
        />
      </div>

      <Dialog open={importMsg != null} onOpenChange={(o) => !o && setImportMsg(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{importMsg?.kind === 'ok' ? 'Import complete' : 'Import failed'}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{importMsg?.text}</p>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">OK</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <p className="text-sm text-muted-foreground">What should happen to the prompts inside it?</p>
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

interface Group {
  key: string
  label: string
  folder: Folder | null
  items: Prompt[]
}

function FolderGroup({
  group,
  collapsed,
  selectedPromptId,
  onToggleCollapse,
  onNewPrompt,
  onFolderOptions,
  onSelect,
  onDelete,
  onExport,
}: {
  group: Group
  collapsed: boolean
  selectedPromptId: string | null
  onToggleCollapse: () => void
  onNewPrompt: () => void
  onFolderOptions: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onExport: (p: Prompt) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:${group.key}` })

  return (
    <div ref={setNodeRef} className={cn('mb-1 rounded-md', isOver && 'bg-primary/10 ring-1 ring-primary/40')}>
      <div className="group flex items-center gap-1 px-1 py-1 text-xs font-medium text-muted-foreground">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex flex-1 items-center gap-1 hover:text-foreground"
        >
          <ChevronRight className={cn('size-3 transition-transform', !collapsed && 'rotate-90')} />
          {group.label}
          <span className="text-muted-foreground/60">{group.items.length}</span>
        </button>
        {group.folder && (
          <>
            <button
              type="button"
              aria-label={`New prompt in ${group.label}`}
              onClick={onNewPrompt}
              className="hidden text-muted-foreground hover:text-foreground group-hover:block"
            >
              <FilePlus2 className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Folder options for ${group.label}`}
              onClick={onFolderOptions}
              className="hidden text-muted-foreground hover:text-foreground group-hover:block"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </>
        )}
      </div>

      {!collapsed && (
        <SortableContext items={group.items.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((p) => (
              <PromptRow
                key={p.id}
                prompt={p}
                selected={p.id === selectedPromptId}
                onSelect={() => onSelect(p.id)}
                onDelete={() => onDelete(p.id)}
                onExport={() => onExport(p)}
              />
            ))}
            {group.items.length === 0 && (
              <li className="px-2 py-1 text-xs text-muted-foreground/70">empty — drop a prompt here</li>
            )}
          </ul>
        </SortableContext>
      )}
    </div>
  )
}

function PromptRow({
  prompt,
  selected,
  onSelect,
  onDelete,
  onExport,
}: {
  prompt: Prompt
  selected: boolean
  onSelect: () => void
  onDelete: () => void
  onExport: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: prompt.id,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group flex items-center gap-1 rounded-md px-2 py-1 text-sm',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40',
        isDragging && 'z-10 opacity-80 shadow-md ring-1 ring-border',
      )}
      {...attributes}
      {...listeners}
    >
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 truncate text-left" title={prompt.name}>
        {prompt.name}
        {isDirty(prompt) && <span className="ml-1 text-muted-foreground">•</span>}
      </button>
      <button
        type="button"
        aria-label={`Export ${prompt.name}`}
        onClick={onExport}
        className="hidden shrink-0 text-muted-foreground hover:text-foreground group-hover:block"
      >
        <Download className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={`Delete ${prompt.name}`}
        onClick={onDelete}
        className="hidden shrink-0 text-muted-foreground hover:text-destructive group-hover:block"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  )
}
