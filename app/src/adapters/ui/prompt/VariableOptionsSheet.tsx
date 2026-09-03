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
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { newId, type VariableOption } from '@/core/prompt/promptModel'
import {
  optionLabel,
  optionsToLines,
  parseOptionLines,
  PRESET_OPTION_SETS,
} from '@/core/prompt/variableOptions'

interface Row extends VariableOption {
  _id: string
}

interface VariableOptionsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  variableName: string
  options: VariableOption[]
  allowCustom: boolean
  /** Current default value — shown so the editor can flag it going stale. */
  defaultValue?: string
  onSubmit: (next: { options: VariableOption[]; allowCustom: boolean; defaultValue?: string }) => void
}

const NONE = '__none__'

const toRows = (opts: VariableOption[]): Row[] =>
  opts.map((o) => ({ ...o, _id: newId('opt') }))

/** Side sheet for authoring a `kind: 'select'` variable's option list. */
export function VariableOptionsSheet({
  open,
  onOpenChange,
  variableName,
  options,
  allowCustom,
  defaultValue,
  onSubmit,
}: VariableOptionsSheetProps) {
  const [rows, setRows] = useState<Row[]>(() => toRows(options))
  const [custom, setCustom] = useState(allowCustom)
  const [def, setDef] = useState(defaultValue ?? '')
  const [bulk, setBulk] = useState('')
  const [showBulk, setShowBulk] = useState(false)

  // Latest seed props, read (not depended on) when the sheet (re)opens.
  const seed = useRef({ options, allowCustom, defaultValue })
  seed.current = { options, allowCustom, defaultValue }

  useEffect(() => {
    if (!open) return
    setRows(toRows(seed.current.options))
    setCustom(seed.current.allowCustom)
    setDef(seed.current.defaultValue ?? '')
    setBulk('')
    setShowBulk(false)
  }, [open, variableName])

  const values = useMemo(() => rows.map((r) => r.value), [rows])
  const dupes = useMemo(() => {
    const seen = new Set<string>()
    const bad = new Set<string>()
    for (const v of values) {
      if (v && seen.has(v)) bad.add(v)
      seen.add(v)
    }
    return bad
  }, [values])
  const cleanRows = rows.filter((r) => r.value.trim())
  const defaultStale = def !== '' && !values.includes(def)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function patchRow(id: string, patch: Partial<VariableOption>) {
    setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)))
  }
  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r._id !== id))
  }
  function addRow() {
    setRows((rs) => [...rs, { _id: newId('opt'), value: '' }])
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setRows((rs) => {
      const from = rs.findIndex((r) => r._id === active.id)
      const to = rs.findIndex((r) => r._id === over.id)
      if (from === -1 || to === -1) return rs
      const next = [...rs]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }
  function applyOptions(next: VariableOption[], mode: 'replace' | 'append') {
    setRows((rs) => {
      if (mode === 'replace') return toRows(next)
      const seen = new Set(rs.map((r) => r.value))
      return [...rs, ...toRows(next.filter((p) => !seen.has(p.value)))]
    })
  }
  function applyBulk(mode: 'replace' | 'append') {
    const parsed = parseOptionLines(bulk)
    if (parsed.length === 0) return
    applyOptions(parsed, mode)
    setBulk('')
    setShowBulk(false)
  }

  function save() {
    const finalOptions: VariableOption[] = cleanRows.map((r) => ({
      value: r.value.trim(),
      ...(r.label && r.label.trim() && r.label.trim() !== r.value.trim()
        ? { label: r.label.trim() }
        : {}),
    }))
    const finalDefault = def && finalOptions.some((o) => o.value === def) ? def : undefined
    onSubmit({ options: finalOptions, allowCustom: custom, defaultValue: finalDefault })
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[calc(100%-2rem)] sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            Options — <span className="font-mono text-sm">{`{{${variableName}}}`}</span>
          </SheetTitle>
          <SheetDescription>
            Fill &amp; Copy shows a dropdown of these choices. <span className="font-mono">value</span>{' '}
            is substituted into the prompt; the label is just what the picker shows.
          </SheetDescription>
        </SheetHeader>

        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
          {/* Preset seed sets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground">PRESETS</span>
            {PRESET_OPTION_SETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="outline"
                size="xs"
                onClick={() => applyOptions([...preset.options], rows.length === 0 ? 'replace' : 'append')}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          {/* Option rows */}
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 px-0.5 text-[11px] font-medium tracking-wide text-muted-foreground">
              <span className="w-5" />
              <span>VALUE</span>
              <span>LABEL (optional)</span>
              <span className="w-7" />
            </div>
            {rows.length === 0 && (
              <p className="rounded-md border border-dashed border-border/60 px-2 py-3 text-center text-xs text-muted-foreground">
                No options yet — pick a preset, add rows, or paste a list below.
              </p>
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={rows.map((r) => r._id)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-1.5">
                  {rows.map((row) => (
                    <OptionRow
                      key={row._id}
                      row={row}
                      invalid={dupes.has(row.value)}
                      onChange={(patch) => patchRow(row._id, patch)}
                      onRemove={() => removeRow(row._id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            {dupes.size > 0 && (
              <p className="text-xs text-destructive">Duplicate values are ignored on save.</p>
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="xs" onClick={addRow}>
                <Plus /> Add option
              </Button>
              <Button type="button" variant="ghost" size="xs" onClick={() => setShowBulk((s) => !s)}>
                {showBulk ? 'Hide bulk paste' : 'Bulk paste'}
              </Button>
            </div>
          </div>

          {showBulk && (
            <div className="flex flex-col gap-1.5 rounded-md border border-border/60 p-2">
              <Label className="text-xs text-muted-foreground">
                One per line — <span className="font-mono">value</span> or{' '}
                <span className="font-mono">value | Label</span>
              </Label>
              <Textarea
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                rows={5}
                placeholder={'prod | Production\nstaging | Staging\ndev | Development'}
                className="font-mono text-xs"
              />
              <div className="flex gap-2">
                <Button type="button" size="xs" onClick={() => applyBulk('replace')} disabled={!bulk.trim()}>
                  Replace list
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => applyBulk('append')}
                  disabled={!bulk.trim()}
                >
                  Append
                </Button>
                {rows.length > 0 && (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => setBulk(optionsToLines(rows))}
                  >
                    Load current
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Default + custom */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Default selection</Label>
            <Select value={def || NONE} onValueChange={(v) => setDef(v === NONE ? '' : (v ?? ''))}>
              <SelectTrigger size="sm">
                <SelectValue>
                  {(v) => {
                    if (!v || v === NONE) return '— none —'
                    const hit = cleanRows.find((r) => r.value.trim() === v)
                    return hit ? optionLabel(hit) : String(v)
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— none —</SelectItem>
                {cleanRows.map((r) => (
                  <SelectItem key={r._id} value={r.value.trim()}>
                    {optionLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {defaultStale && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                Current default “{def}” isn’t in the list — it will be cleared on save.
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={custom} onCheckedChange={(v) => setCustom(v === true)} />
            Allow a custom value not in this list
          </label>
        </div>

        <SheetFooter>
          <SheetClose render={<Button variant="outline">Cancel</Button>} />
          <Button onClick={save}>Save options</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function OptionRow({
  row,
  invalid,
  onChange,
  onRemove,
}: {
  row: Row
  invalid: boolean
  onChange: (patch: Partial<VariableOption>) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row._id,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2 ${isDragging ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="flex size-5 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      <Input
        value={row.value}
        onChange={(e) => onChange({ value: e.target.value })}
        placeholder="prod"
        aria-invalid={invalid || undefined}
        className="h-8 font-mono text-xs"
      />
      <Input
        value={row.label ?? ''}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder="Production"
        className="h-8 text-xs"
      />
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove option" onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  )
}
