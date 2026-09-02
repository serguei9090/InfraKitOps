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
import { useRef, useState } from 'react'
import { Download, GripVertical, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useThemeStore } from '@/stores/themeStore'
import { useModuleVisibilityStore } from '@/stores/moduleVisibilityStore'
import { useBackendStore } from '@/stores/backendStore'
import { useAuthStore } from '@/stores/authStore'
import { canSeeModule } from '@/core/auth/authModel'
import { reportError } from '@/stores/errorStore'
import { kModuleTaxonomy, type ModuleDef } from '@/adapters/ui/shell/moduleTaxonomy'
import { SettingsGroup, SettingsRow } from '../SettingsScaffold'
import { SettingsResetButton } from '../SettingsResetButton'
import { applyBackup, buildBackup, downloadBackup } from '../settingsBackup'
import { ShortcutSettings } from './ShortcutSettings'

export function GeneralSettings() {
  const mode = useThemeStore((s) => s.mode)
  const toggleTheme = useThemeStore((s) => s.toggle)
  const resetTheme = useThemeStore((s) => s.reset)
  const railExpanded = useModuleVisibilityStore((s) => s.railExpanded)
  const toggleRail = useModuleVisibilityStore((s) => s.toggleRailExpanded)
  const resetModules = useModuleVisibilityStore((s) => s.reset)

  return (
    <>
      <SettingsGroup title="Appearance">
        <SettingsRow label="Dark theme">
          <Switch checked={mode === 'dark'} onCheckedChange={() => toggleTheme()} />
        </SettingsRow>
        <SettingsRow label="Expanded sidebar" hint="Show module names next to the rail icons">
          <Switch checked={railExpanded} onCheckedChange={() => toggleRail()} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Modules"
        description="Drag to reorder the rail. Uncheck to hide a module from the rail and the All Tools page."
      >
        <ModuleOrderList />
      </SettingsGroup>

      <SettingsGroup title="Keyboard shortcuts">
        <ShortcutSettings />
      </SettingsGroup>

      <SettingsGroup
        title="Backup"
        description="Export every setting (theme, module layout, network, AI defaults, Runbooks) as one JSON file. No secrets — Vault contents and API keys are never included."
      >
        <BackupControls />
      </SettingsGroup>

      <SettingsResetButton
        onReset={() => {
          resetTheme()
          resetModules()
        }}
      />
    </>
  )
}

function BackupControls() {
  const backendAvailable = useBackendStore((s) => s.status === 'available')
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [imported, setImported] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="xs"
        variant="outline"
        disabled={busy !== null}
        onClick={async () => {
          setBusy('export')
          try {
            downloadBackup(await buildBackup(backendAvailable))
          } catch (e) {
            reportError(e, 'Settings')
          } finally {
            setBusy(null)
          }
        }}
      >
        <Download className="size-3.5" /> Export
      </Button>
      <Button size="xs" variant="outline" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
        <Upload className="size-3.5" /> Import
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy('import')
          setImported(false)
          try {
            await applyBackup(JSON.parse(await file.text()))
            setImported(true)
          } catch (err) {
            reportError(err, 'Settings')
          } finally {
            setBusy(null)
          }
        }}
      />
      {imported && <span className="text-xs text-emerald-600 dark:text-emerald-500">Settings imported.</span>}
      {!backendAvailable && (
        <span className="text-xs text-muted-foreground">Backend off — AI / Runbooks settings excluded.</span>
      )}
    </div>
  )
}

function ModuleOrderList() {
  const storeOrder = useModuleVisibilityStore((s) => s.order)
  const hiddenIds = useModuleVisibilityStore((s) => s.hiddenIds)
  const reorder = useModuleVisibilityStore((s) => s.reorder)
  const toggleHidden = useModuleVisibilityStore((s) => s.toggleHidden)
  const me = useAuthStore((s) => s.me)
  const byId = new Map(kModuleTaxonomy.map((m) => [m.id, m]))
  // multi-user: only list modules this account may actually open
  const order = storeOrder.filter((id) => canSeeModule(me, id))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    // indices are against the full store order, not the filtered view
    const from = storeOrder.indexOf(String(active.id))
    const to = storeOrder.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    reorder(from, to)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-1">
          {order.map((id) => {
            const m = byId.get(id)
            if (!m) return null
            return <ModuleRow key={id} id={id} module={m} hidden={hiddenIds.includes(id)} onToggle={() => toggleHidden(id)} />
          })}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function ModuleRow({
  id,
  module,
  hidden,
  onToggle,
}: {
  id: string
  module: ModuleDef
  hidden: boolean
  onToggle: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const Icon = module.icon
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-lg bg-background px-2 py-1.5',
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
      <Checkbox checked={!hidden} onCheckedChange={onToggle} />
    </div>
  )
}
