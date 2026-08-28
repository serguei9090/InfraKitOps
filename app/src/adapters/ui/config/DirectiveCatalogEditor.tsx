import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/**
 * Shared "pick directives from a typed catalog" editor for the config
 * builders (SSH, sysctl, Zabbix, RDP, …). Each of those tools has the same
 * shape — a flat catalog of independent key/value directives, grouped, where
 * only the ones the user ticks end up in the generated file — but had four
 * hand-rolled copies of the checkbox list + per-kind control + collapsible
 * groups + search. This is the one implementation.
 *
 * It owns *presentation and selection state only*. The screen still owns its
 * catalog data, its mode switches, and the pure `execute()` that serialises
 * the selected `values` into that tool's file format (`Key Value`, `k = v`,
 * `k:i:v`, …) — that part is genuinely per-tool.
 */

export interface CatalogGroup {
  /** Stable id referenced by `CatalogItem.group`. */
  id: string
  label: string
}

export type CatalogControl =
  | {
      kind: 'toggle'
      /** Value written when on / off. Defaults to '1' / '0' — SSH passes 'yes' / 'no'. */
      trueValue?: string
      falseValue?: string
    }
  | { kind: 'select'; choices: readonly { value: string; label: string }[] }
  | {
      kind: 'text'
      placeholder?: string
      numeric?: boolean
      min?: number
      max?: number
      /** Optional live check on the current value; a returned string is shown in red under the field. */
      validate?: (value: string) => string | null
    }

export interface CatalogItem {
  /** The literal directive key. Also the key into the `values` record. */
  key: string
  /** `CatalogGroup.id` this item belongs to. */
  group: string
  /** Display name; defaults to `key`. */
  label?: string
  description: string
  control: CatalogControl
  /** Value written into `values` the moment the box is ticked. */
  seedValue: string
  /** Small pill after the key (e.g. "hardened"). */
  badge?: string
  /** Muted one-liner under the description (default value, version note). */
  meta?: string
  /** Red one-liner under the description (risk / caution). */
  warning?: string
}

export interface CatalogPreset {
  id: string
  label: string
  description?: string
  /** Directive key → value. Merged onto the current selection. */
  values: Record<string, string>
}

interface DirectiveCatalogEditorProps {
  groups: readonly CatalogGroup[]
  items: readonly CatalogItem[]
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
  /** One-click starting points. Rendered as buttons. */
  presets?: readonly CatalogPreset[]
  /** Extra controls (mode switch, output-type toggle) shown above the search box. */
  toolbar?: ReactNode
  searchPlaceholder?: string
  /** Group ids expanded on first render. Groups with a selection auto-expand too. */
  defaultOpenGroups?: readonly string[]
}

const TOGGLE_TRUE = '1'
const TOGGLE_FALSE = '0'

export function DirectiveCatalogEditor({
  groups,
  items,
  values,
  onChange,
  presets,
  toolbar,
  searchPlaceholder,
  defaultOpenGroups = [],
}: DirectiveCatalogEditorProps) {
  const [query, setQuery] = useState('')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(defaultOpenGroups.map((id) => [id, true])),
  )

  const q = query.trim().toLowerCase()
  const selectedCount = Object.keys(values).length

  const matches = useMemo(() => {
    return (item: CatalogItem) => {
      if (selectedOnly && !(item.key in values)) return false
      if (q.length === 0) return true
      return (
        item.key.toLowerCase().includes(q) ||
        (item.label?.toLowerCase().includes(q) ?? false) ||
        item.description.toLowerCase().includes(q)
      )
    }
  }, [q, selectedOnly, values])

  const visibleByGroup = useMemo(() => {
    const map = new Map<string, CatalogItem[]>()
    for (const item of items) {
      if (!matches(item)) continue
      const arr = map.get(item.group) ?? []
      arr.push(item)
      map.set(item.group, arr)
    }
    return map
  }, [items, matches])

  const anyVisible = [...visibleByGroup.values()].some((a) => a.length > 0)

  function setValue(key: string, value: string) {
    onChange({ ...values, [key]: value })
  }

  function toggleItem(item: CatalogItem, checked: boolean) {
    const next = { ...values }
    if (checked) next[item.key] = values[item.key] ?? item.seedValue
    else delete next[item.key]
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-3">
      {toolbar}

      {presets && presets.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Presets</span>
          {presets.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant="outline"
              title={preset.description}
              onClick={() => onChange({ ...values, ...preset.values })}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder ?? `Search ${items.length} directives…`}
          className="h-9 pl-9"
        />
        {query.length > 0 ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {selectedCount} selected — only these appear in the output
        </span>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5">
            <Checkbox
              checked={selectedOnly}
              onCheckedChange={(c) => setSelectedOnly(c === true)}
              disabled={selectedCount === 0}
            />
            Selected only
          </label>
          {selectedCount > 0 ? (
            <Button type="button" size="sm" variant="ghost" className="h-6 px-2" onClick={() => onChange({})}>
              Clear all
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {groups.map((group) => {
          const groupItems = visibleByGroup.get(group.id) ?? []
          if (groupItems.length === 0) return null
          const total = items.filter((i) => i.group === group.id).length
          const selectedInGroup = groupItems.filter((i) => i.key in values).length
          const isOpen = q.length > 0 || selectedOnly || (open[group.id] ?? selectedInGroup > 0)

          return (
            <div key={group.id} className="rounded-lg border border-border/60">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
                onClick={() => setOpen((prev) => ({ ...prev, [group.id]: !isOpen }))}
              >
                {isOpen ? (
                  <ChevronDown className="size-4 shrink-0" />
                ) : (
                  <ChevronRight className="size-4 shrink-0" />
                )}
                <span className="flex-1 text-sm font-semibold">{group.label}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {groupItems.length === total ? `${total}` : `${groupItems.length} / ${total}`}
                </span>
                {selectedInGroup > 0 ? <Badge variant="secondary">{selectedInGroup}</Badge> : null}
              </button>
              {isOpen ? (
                <div className="flex flex-col divide-y divide-border/40 border-t border-border/60 px-3">
                  {groupItems.map((item) => (
                    <ItemRow
                      key={item.key}
                      item={item}
                      checked={item.key in values}
                      value={values[item.key] ?? item.seedValue}
                      onToggle={(c) => toggleItem(item, c)}
                      onChange={(v) => setValue(item.key, v)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}

        {!anyVisible ? (
          <p className="py-6 text-sm text-muted-foreground">
            {selectedOnly && q.length === 0
              ? 'Nothing selected yet.'
              : `No directives match "${query.trim()}".`}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function ItemRow({
  item,
  checked,
  value,
  onToggle,
  onChange,
}: {
  item: CatalogItem
  checked: boolean
  value: string
  onToggle: (checked: boolean) => void
  onChange: (value: string) => void
}) {
  const control = item.control
  const trueValue = control.kind === 'toggle' ? (control.trueValue ?? TOGGLE_TRUE) : TOGGLE_TRUE
  const falseValue = control.kind === 'toggle' ? (control.falseValue ?? TOGGLE_FALSE) : TOGGLE_FALSE

  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-start gap-2">
        <Checkbox checked={checked} onCheckedChange={(c) => onToggle(c === true)} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn('font-mono text-xs font-semibold', checked && 'text-primary')}>
              {item.label ?? item.key}
            </span>
            {item.badge ? <Badge variant="secondary">{item.badge}</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">{item.description}</p>
          {item.meta ? <p className="text-[11px] text-muted-foreground/80">{item.meta}</p> : null}
          {item.warning ? <p className="mt-0.5 text-xs text-destructive">{item.warning}</p> : null}
        </div>
      </div>
      {checked ? (
        <div className="ml-6">
          {control.kind === 'toggle' ? (
            <div className="flex items-center gap-2">
              <Switch
                checked={value === trueValue}
                onCheckedChange={(on) => onChange(on ? trueValue : falseValue)}
              />
              <span className="font-mono text-xs">{value === trueValue ? trueValue : falseValue}</span>
            </div>
          ) : control.kind === 'select' ? (
            <Select
              value={control.choices.some((c) => c.value === value) ? value : control.choices[0]?.value}
              onValueChange={(v) => onChange(String(v))}
            >
              <SelectTrigger className="w-full max-w-md" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {control.choices.map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <>
              <Input
                className="max-w-md font-mono text-xs"
                type={control.numeric ? 'number' : 'text'}
                value={value}
                placeholder={control.placeholder}
                min={control.min}
                max={control.max}
                onChange={(e) => onChange(e.target.value)}
              />
              {control.validate?.(value) ? (
                <p className="mt-1 text-xs text-destructive">{control.validate(value)}</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
