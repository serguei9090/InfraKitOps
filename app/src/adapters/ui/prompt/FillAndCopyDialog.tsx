import { AlertTriangle, Check, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { extractVariables } from '@/core/prompt/variableExtractor'
import {
  COPY_FORMATS,
  countUnfilled,
  renderAll,
  renderMessage,
  type CopyFormat,
} from '@/core/prompt/promptRenderer'
import type { Message, Prompt, VariableMeta } from '@/core/prompt/promptModel'
import { optionLabel } from '@/core/prompt/variableOptions'
import { cn } from '@/lib/utils'

const CUSTOM = '__custom__'
const CLEAR = '__clear__'

/** One fill field, rendered per the variable's `meta.kind` (default: text). */
function VariableField({
  name,
  meta,
  value,
  onChange,
}: {
  name: string
  meta: VariableMeta | undefined
  value: string
  onChange: (v: string) => void
}) {
  const kind = meta?.kind ?? 'text'
  const options = meta?.options ?? []
  const inList = options.some((o) => o.value === value)
  const [custom, setCustom] = useState(!inList && value !== '')

  if (kind === 'select') {
    return (
      <div className="flex flex-col gap-1">
        <Select
          value={custom ? CUSTOM : value || ''}
          onValueChange={(v) => {
            if (!v) return
            if (v === CUSTOM) {
              setCustom(true)
              return
            }
            if (v === CLEAR) {
              setCustom(false)
              onChange('')
              return
            }
            setCustom(false)
            onChange(v)
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select…">
              {(v) => {
                if (v === CUSTOM) return 'Custom…'
                if (!v) return 'Select…'
                const hit = options.find((o) => o.value === v)
                return hit ? optionLabel(hit) : String(v)
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {optionLabel(o)}
              </SelectItem>
            ))}
            {meta?.allowCustom && <SelectItem value={CUSTOM}>Custom…</SelectItem>}
            {!meta?.required && <SelectItem value={CLEAR}>— clear —</SelectItem>}
          </SelectContent>
        </Select>
        {custom && (
          <Input
            autoFocus
            value={value}
            placeholder="Custom value"
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
    )
  }

  if (kind === 'boolean') {
    return (
      <Select value={value || ''} onValueChange={(v) => v && onChange(v === CLEAR ? '' : v)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="—">
            {(v) => (v === 'true' ? 'Yes' : v === 'false' ? 'No' : '—')}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Yes</SelectItem>
          <SelectItem value="false">No</SelectItem>
          {!meta?.required && <SelectItem value={CLEAR}>— clear —</SelectItem>}
        </SelectContent>
      </Select>
    )
  }

  if (kind === 'textarea') {
    return (
      <Textarea
        id={`var-${name}`}
        value={value}
        rows={3}
        placeholder={meta?.description ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  return (
    <Input
      id={`var-${name}`}
      type={kind === 'number' ? 'number' : 'text'}
      min={meta?.min}
      max={meta?.max}
      step={meta?.step}
      value={value}
      placeholder={meta?.description ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

const ROLE_LABEL: Record<Message['role'], string> = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
}

interface FillAndCopyDialogProps {
  prompt: Prompt
  messages: Message[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FillAndCopyDialog({ prompt, messages, open, onOpenChange }: FillAndCopyDialogProps) {
  const variables = useMemo(() => extractVariables(messages), [messages])
  const [values, setValues] = useState<Record<string, string>>({})
  const [format, setFormat] = useState<CopyFormat>('text')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Seed defaults whenever the dialog opens.
  const effectiveValues = useMemo(() => {
    const seeded: Record<string, string> = {}
    for (const name of variables) {
      seeded[name] = values[name] ?? prompt.variables[name]?.defaultValue ?? ''
    }
    return seeded
  }, [variables, values, prompt.variables])

  const unfilled = countUnfilled(messages, effectiveValues)
  const requiredMissing = variables.filter(
    (name) => prompt.variables[name]?.required && !effectiveValues[name],
  )
  const blocked = requiredMissing.length > 0

  async function copy(text: string, key: string) {
    if (blocked) return
    await navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Fill &amp; copy — {prompt.name}</DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-[minmax(0,240px)_1fr]">
          {/* Variables */}
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">VARIABLES</p>
            {variables.length === 0 ? (
              <p className="text-sm text-muted-foreground">This prompt has no {'{{variables}}'}.</p>
            ) : (
              variables.map((name) => {
                const meta = prompt.variables[name]
                return (
                  <div key={name} className="flex flex-col gap-1">
                    <Label htmlFor={`var-${name}`} className="flex items-center gap-1.5 font-mono text-xs">
                      {`{{${name}}}`}
                      {meta?.required && (
                        <span className="font-sans text-[10px] text-amber-600 dark:text-amber-500">
                          required
                        </span>
                      )}
                    </Label>
                    <VariableField
                      name={name}
                      meta={meta}
                      value={effectiveValues[name]}
                      onChange={(v) => setValues((prev) => ({ ...prev, [name]: v }))}
                    />
                  </div>
                )
              })
            )}
            {blocked && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="size-3.5" />
                Fill {requiredMissing.map((n) => `{{${n}}}`).join(', ')} to copy.
              </p>
            )}
            {!blocked && unfilled > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                <AlertTriangle className="size-3.5" />
                {unfilled} variable{unfilled === 1 ? '' : 's'} unfilled — left as {'{{…}}'}
              </p>
            )}
          </div>

          {/* Rendered preview + per-message copy */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium tracking-wide text-muted-foreground">PREVIEW</p>
              <div className="flex items-center gap-2">
                <Select value={format} onValueChange={(v) => v && setFormat(v as CopyFormat)}>
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COPY_FORMATS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={blocked}
                  onClick={() => copy(renderAll(messages, effectiveValues, format), '__all')}
                >
                  {copiedKey === '__all' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  Copy all
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {messages.map((m) => {
                const rendered = renderMessage(m, effectiveValues)
                return (
                  <div key={m.id} className="rounded-lg border border-border/60 bg-card">
                    <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1">
                      <span className="text-xs font-medium text-muted-foreground">{ROLE_LABEL[m.role]}</span>
                      <div className="flex-1" />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={blocked}
                        aria-label={`Copy ${m.role} message`}
                        onClick={() => copy(rendered, m.id)}
                      >
                        {copiedKey === m.id ? (
                          <Check className="size-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </Button>
                    </div>
                    <pre
                      className={cn(
                        'max-h-52 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[13px]',
                        rendered.length === 0 && 'text-muted-foreground italic',
                      )}
                    >
                      {rendered || '(empty)'}
                    </pre>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Close</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
