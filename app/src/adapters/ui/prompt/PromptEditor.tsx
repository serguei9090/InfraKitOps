import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Eye, Plus, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  currentMessages,
  emptyMessage,
  versionMessages,
  type Message,
  type Prompt,
  type Role,
} from '@/core/prompt/promptModel'
import { usePromptLibraryStore } from '@/stores/promptLibraryStore'
import { TEMPLATE_TAGS } from '@/core/prompt/templates/index'
import { MessageCard } from './MessageCard'

const NO_FOLDER = '__none__'

function SortableMessageCard(props: {
  message: Message
  index: number
  count: number
  promptName?: string
  onChange: (patch: Partial<Pick<Message, 'role' | 'content'>>) => void
  onMove: (dir: -1 | 1) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.message.id,
  })
  return (
    <MessageCard
      {...props}
      drag={{
        setNodeRef,
        style: { transform: CSS.Transform.toString(transform), transition },
        isDragging,
        handleProps: { ...attributes, ...listeners },
      }}
    />
  )
}

interface PromptEditorProps {
  prompt: Prompt
}

export function PromptEditor({ prompt }: PromptEditorProps) {
  const renamePrompt = usePromptLibraryStore((s) => s.renamePrompt)
  const setTags = usePromptLibraryStore((s) => s.setTags)
  const editMessages = usePromptLibraryStore((s) => s.editMessages)
  const moveToFolder = usePromptLibraryStore((s) => s.moveToFolder)
  const restoreVersion = usePromptLibraryStore((s) => s.restoreVersion)
  const viewingVersion = usePromptLibraryStore((s) => s.viewingVersion)
  const prompts = usePromptLibraryStore((s) => s.prompts)
  const folders = usePromptLibraryStore((s) => s.folders)
  const allTags = useMemo(
    () => [...new Set([...prompts.flatMap((p) => p.tags), ...TEMPLATE_TAGS])],
    [prompts],
  )
  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.name.localeCompare(b.name)),
    [folders],
  )

  const readOnly = viewingVersion != null
  const messages =
    viewingVersion != null ? (versionMessages(prompt, viewingVersion) ?? []) : currentMessages(prompt)

  // Local name buffer so typing doesn't thrash the store on every keystroke.
  // The editor is re-keyed by prompt id upstream, so this re-inits on switch.
  const [name, setName] = useState(prompt.name)

  const [tagInput, setTagInput] = useState('')
  const tagFieldId = useId()

  function commitName() {
    const trimmed = name.trim()
    if (trimmed && trimmed !== prompt.name) renamePrompt(prompt.id, trimmed)
    else setName(prompt.name)
  }

  function update(next: Message[]) {
    editMessages(prompt.id, next)
  }

  function addMessage(role: Role) {
    update([...messages, emptyMessage(role)])
  }

  function patchMessage(id: string, patch: Partial<Pick<Message, 'role' | 'content'>>) {
    update(messages.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  function moveMessage(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= messages.length) return
    const next = [...messages]
    ;[next[index], next[target]] = [next[target], next[index]]
    update(next)
  }

  function duplicateMessage(index: number) {
    const src = messages[index]
    const copy = { ...emptyMessage(src.role), content: src.content }
    update([...messages.slice(0, index + 1), copy, ...messages.slice(index + 1)])
  }

  function deleteMessage(id: string) {
    if (messages.length === 1) return
    update(messages.filter((m) => m.id !== id))
  }

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase()
    if (!tag || prompt.tags.includes(tag)) {
      setTagInput('')
      return
    }
    setTags(prompt.id, [...prompt.tags, tag])
    setTagInput('')
  }

  function removeTag(tag: string) {
    setTags(
      prompt.id,
      prompt.tags.filter((t) => t !== tag),
    )
  }

  const tagSuggestions = allTags
    .filter((t) => !prompt.tags.includes(t))
    .filter((t) => t.includes(tagInput.trim().toLowerCase()))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleMessageDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = messages.findIndex((m) => m.id === active.id)
    const to = messages.findIndex((m) => m.id === over.id)
    if (from === -1 || to === -1) return
    const next = [...messages]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    update(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/60 p-4">
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            className="h-9 border-0 px-1 text-lg font-semibold shadow-none focus-visible:ring-0"
            placeholder="Prompt name"
          />
          <Select
            value={prompt.folderId ?? NO_FOLDER}
            onValueChange={(v) => v && moveToFolder(prompt.id, v === NO_FOLDER ? null : v)}
          >
            <SelectTrigger size="sm" className="shrink-0 text-muted-foreground">
              <SelectValue>
                {(value) =>
                  value === NO_FOLDER || value == null
                    ? 'Unfiled'
                    : (sortedFolders.find((f) => f.id === value)?.name ?? 'Unfiled')
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_FOLDER}>Unfiled</SelectItem>
              {sortedFolders.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {prompt.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => removeTag(tag)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <input
            list={tagFieldId}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addTag(tagInput)
              }
            }}
            onBlur={() => tagInput.trim() && addTag(tagInput)}
            placeholder="+ tag"
            className="h-6 w-20 rounded-md bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground focus:w-32 focus:ring-1 focus:ring-ring"
          />
          <datalist id={tagFieldId}>
            {tagSuggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      </div>

      {readOnly && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-amber-500/10 px-4 py-2 text-xs">
          <Eye className="size-3.5 text-amber-600 dark:text-amber-500" />
          <span>Viewing v{viewingVersion} — read-only.</span>
          <div className="flex-1" />
          <Button size="xs" variant="outline" onClick={() => restoreVersion(prompt.id, viewingVersion!)}>
            Restore to edit
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2.5">
          {readOnly ? (
            messages.map((m, i) => (
              <MessageCard
                key={m.id}
                message={m}
                index={i}
                count={messages.length}
                readOnly
                onChange={() => {}}
                onMove={() => {}}
                onDuplicate={() => {}}
                onDelete={() => {}}
              />
            ))
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleMessageDragEnd}>
              <SortableContext items={messages.map((m) => m.id)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2.5">
                  {messages.map((m, i) => (
                    <SortableMessageCard
                      key={m.id}
                      message={m}
                      index={i}
                      count={messages.length}
                      promptName={name}
                      onChange={(patch) => patchMessage(m.id, patch)}
                      onMove={(dir) => moveMessage(i, dir)}
                      onDuplicate={() => duplicateMessage(i)}
                      onDelete={() => deleteMessage(m.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {!readOnly && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => addMessage('system')}>
                <Plus className="size-3.5" /> System
              </Button>
              <Button variant="outline" size="sm" onClick={() => addMessage('user')}>
                <Plus className="size-3.5" /> User
              </Button>
              <Button variant="outline" size="sm" onClick={() => addMessage('assistant')}>
                <Plus className="size-3.5" /> Assistant
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
