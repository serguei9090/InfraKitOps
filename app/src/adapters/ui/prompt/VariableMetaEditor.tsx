import { Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  isVariableMetaEmpty,
  type VariableKind,
  type VariableMeta,
} from '@/core/prompt/promptModel'
import { optionLabel } from '@/core/prompt/variableOptions'
import { VariableOptionsSheet } from './VariableOptionsSheet'

interface VariableMetaEditorProps {
  variableName: string
  meta: VariableMeta
  onChange: (meta: VariableMeta) => void
}

const KIND_LABELS: Record<VariableKind, string> = {
  text: 'Text',
  textarea: 'Long text',
  select: 'Dropdown',
  boolean: 'Yes / no',
  number: 'Number',
}

const BOOL_NONE = '__none__'

/** The per-variable metadata form shown in the expanded inspector row:
 *  description, input type, type-specific controls, default value, required. */
export function VariableMetaEditor({ variableName, meta, onChange }: VariableMetaEditorProps) {
  const [optionsOpen, setOptionsOpen] = useState(false)
  const kind: VariableKind = meta.kind ?? 'text'

  /** Merge a patch, then normalise to `undefined` when nothing's left. */
  function patch(next: Partial<VariableMeta>) {
    const merged: VariableMeta = { ...meta, ...next }
    onChange(isVariableMetaEmpty(merged) ? {} : merged)
  }

  function changeKind(nextKind: VariableKind) {
    const next: VariableMeta = { ...meta, kind: nextKind === 'text' ? undefined : nextKind }
    if (nextKind !== 'select') {
      delete next.options
      delete next.allowCustom
    }
    if (nextKind !== 'number') {
      delete next.min
      delete next.max
      delete next.step
    }
    if (nextKind === 'boolean' && next.defaultValue && !['true', 'false'].includes(next.defaultValue)) {
      delete next.defaultValue
    }
    onChange(isVariableMetaEmpty(next) ? {} : next)
    if (nextKind === 'select') setOptionsOpen(true)
  }

  const options = meta.options ?? []

  return (
    <div className="flex flex-col gap-2 border-t border-border/60 p-2">
      <Input
        placeholder="Description"
        defaultValue={meta.description ?? ''}
        onBlur={(e) => patch({ description: e.target.value || undefined })}
        className="h-7 text-xs"
      />

      <div className="flex items-center gap-2">
        <Label className="w-14 shrink-0 text-[11px] text-muted-foreground">Type</Label>
        <Select value={kind} onValueChange={(v) => v && changeKind(v as VariableKind)}>
          <SelectTrigger size="sm" className="h-7 flex-1 text-xs">
            <SelectValue>{(v) => KIND_LABELS[(v as VariableKind) ?? 'text'] ?? 'Text'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(KIND_LABELS) as VariableKind[]).map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {kind === 'select' && (
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[11px] text-muted-foreground">Options</span>
          <Button
            variant="outline"
            size="xs"
            className="flex-1 justify-between"
            onClick={() => setOptionsOpen(true)}
          >
            <span className="truncate">
              {options.length === 0
                ? 'None — set up…'
                : options.slice(0, 3).map(optionLabel).join(', ') +
                  (options.length > 3 ? ` +${options.length - 3}` : '')}
            </span>
            <Settings2 />
          </Button>
        </div>
      )}

      {kind === 'number' && (
        <div className="flex items-center gap-1.5">
          <Label className="w-14 shrink-0 text-[11px] text-muted-foreground">Bounds</Label>
          {(['min', 'max', 'step'] as const).map((key) => (
            <Input
              key={key}
              type="number"
              placeholder={key}
              defaultValue={meta[key] ?? ''}
              onBlur={(e) => {
                const raw = e.target.value.trim()
                patch({ [key]: raw === '' ? undefined : Number(raw) })
              }}
              className="h-7 min-w-0 flex-1 text-xs"
            />
          ))}
        </div>
      )}

      {/* Default value — control depends on the type */}
      <div className="flex items-center gap-2">
        <Label className="w-14 shrink-0 text-[11px] text-muted-foreground">Default</Label>
        {kind === 'select' ? (
          <Select
            value={meta.defaultValue || BOOL_NONE}
            onValueChange={(v) =>
              patch({ defaultValue: v && v !== BOOL_NONE ? v : undefined })
            }
          >
            <SelectTrigger size="sm" className="h-7 flex-1 text-xs">
              <SelectValue>
                {(v) => {
                  if (!v || v === BOOL_NONE) return '— none —'
                  const hit = options.find((o) => o.value === v)
                  return hit ? optionLabel(hit) : String(v)
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BOOL_NONE}>— none —</SelectItem>
              {options.map((o, i) => (
                <SelectItem key={i} value={o.value}>
                  {optionLabel(o)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : kind === 'boolean' ? (
          <Select
            value={meta.defaultValue || BOOL_NONE}
            onValueChange={(v) =>
              patch({ defaultValue: v && v !== BOOL_NONE ? v : undefined })
            }
          >
            <SelectTrigger size="sm" className="h-7 flex-1 text-xs">
              <SelectValue>
                {(v) => (v === 'true' ? 'Yes' : v === 'false' ? 'No' : '— none —')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BOOL_NONE}>— none —</SelectItem>
              <SelectItem value="true">Yes</SelectItem>
              <SelectItem value="false">No</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input
            type={kind === 'number' ? 'number' : 'text'}
            placeholder="Default value"
            defaultValue={meta.defaultValue ?? ''}
            onBlur={(e) => patch({ defaultValue: e.target.value || undefined })}
            className="h-7 flex-1 text-xs"
          />
        )}
      </div>

      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={!!meta.required}
          onCheckedChange={(v) => patch({ required: v === true ? true : undefined })}
        />
        Required — block “Copy all” until filled
      </label>

      <VariableOptionsSheet
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        variableName={variableName}
        options={options}
        allowCustom={!!meta.allowCustom}
        defaultValue={meta.defaultValue}
        onSubmit={({ options: nextOptions, allowCustom, defaultValue }) =>
          patch({
            kind: 'select',
            options: nextOptions.length > 0 ? nextOptions : undefined,
            allowCustom: allowCustom || undefined,
            defaultValue,
          })
        }
      />
    </div>
  )
}
