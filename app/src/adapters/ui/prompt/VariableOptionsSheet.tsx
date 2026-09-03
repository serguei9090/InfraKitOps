import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
import type { VariableOption } from '@/core/prompt/promptModel'
import { optionLabel, optionsToLines, parseOptionLines } from '@/core/prompt/variableOptions'

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
  const [rows, setRows] = useState<VariableOption[]>(options)
  const [custom, setCustom] = useState(allowCustom)
  const [def, setDef] = useState(defaultValue ?? '')
  const [bulk, setBulk] = useState('')
  const [showBulk, setShowBulk] = useState(false)

  // Re-seed every time the sheet opens for a (possibly different) variable.
  useEffect(() => {
    if (open) {
      setRows(options)
      setCustom(allowCustom)
      setDef(defaultValue ?? '')
      setBulk('')
      setShowBulk(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function patchRow(i: number, patch: Partial<VariableOption>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i))
  }
  function moveRow(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    setRows((rs) => {
      const next = [...rs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  function addRow() {
    setRows((rs) => [...rs, { value: '' }])
  }
  function applyBulk(mode: 'replace' | 'append') {
    const parsed = parseOptionLines(bulk)
    if (parsed.length === 0) return
    setRows((rs) => {
      if (mode === 'replace') return parsed
      const seen = new Set(rs.map((r) => r.value))
      return [...rs, ...parsed.filter((p) => !seen.has(p.value))]
    })
    setBulk('')
    setShowBulk(false)
  }

  function save() {
    const finalOptions = cleanRows.map((r) => ({
      value: r.value.trim(),
      ...(r.label && r.label.trim() && r.label.trim() !== r.value.trim()
        ? { label: r.label.trim() }
        : {}),
    }))
    const finalDefault =
      def && finalOptions.some((o) => o.value === def) ? def : undefined
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
          {/* Option rows */}
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-0.5 text-[11px] font-medium tracking-wide text-muted-foreground">
              <span>VALUE</span>
              <span>LABEL (optional)</span>
              <span className="w-[4.5rem]" />
            </div>
            {rows.length === 0 && (
              <p className="rounded-md border border-dashed border-border/60 px-2 py-3 text-center text-xs text-muted-foreground">
                No options yet — add rows or paste a list below.
              </p>
            )}
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                <Input
                  value={row.value}
                  onChange={(e) => patchRow(i, { value: e.target.value })}
                  placeholder="prod"
                  aria-invalid={dupes.has(row.value) || undefined}
                  className="h-8 font-mono text-xs"
                />
                <Input
                  value={row.label ?? ''}
                  onChange={(e) => patchRow(i, { label: e.target.value })}
                  placeholder="Production"
                  className="h-8 text-xs"
                />
                <div className="flex items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => moveRow(i, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Move down"
                    disabled={i === rows.length - 1}
                    onClick={() => moveRow(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Remove option"
                    onClick={() => removeRow(i)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
            {dupes.size > 0 && (
              <p className="text-xs text-destructive">Duplicate values are ignored on save.</p>
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="xs" onClick={addRow}>
                <Plus /> Add option
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setShowBulk((s) => !s)}
              >
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
                {cleanRows.map((r, i) => (
                  <SelectItem key={i} value={r.value.trim()}>
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
