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
import { GripVertical } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useModuleVisibilityStore } from '@/stores/moduleVisibilityStore'
import { kModuleTaxonomy, type ModuleDef } from './moduleTaxonomy'

/**
 * The rail's gear-button dialog: drag to reorder modules, checkbox to
 * hide/show. Backed by useModuleVisibilityStore, so the rail and "All
 * Tools" overview update live as you edit here.
 */
export function ModuleSettingsDialog({ trigger }: { trigger: ReactElement }) {
  const { order, hiddenIds, reorder, toggleHidden } = useModuleVisibilityStore()
  const byId = new Map(kModuleTaxonomy.map((m) => [m.id, m]))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = order.indexOf(String(active.id))
    const newIndex = order.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    reorder(oldIndex, newIndex)
  }

  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-96">
        <DialogHeader>
          <DialogTitle>Rearrange modules</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-105">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-1 pr-3">
                {order.map((id) => {
                  const module = byId.get(id)
                  if (!module) return null
                  return (
                    <ModuleRow
                      key={id}
                      id={id}
                      module={module}
                      hidden={hiddenIds.includes(id)}
                      onToggleHidden={() => toggleHidden(id)}
                    />
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        </ScrollArea>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Done</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModuleRow({
  id,
  module,
  hidden,
  onToggleHidden,
}: {
  id: string
  module: ModuleDef
  hidden: boolean
  onToggleHidden: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const Icon = module.icon

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-1.5 bg-background',
        isDragging ? 'z-10 shadow-md ring-1 ring-border' : 'hover:bg-accent/40',
      )}
    >
      <button
        type="button"
        aria-label={`Drag to reorder ${module.title}`}
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <Icon className="size-4 text-muted-foreground" />
      <span className="flex-1 text-sm">{module.title}</span>
      <Checkbox checked={!hidden} onCheckedChange={onToggleHidden} />
    </div>
  )
}
