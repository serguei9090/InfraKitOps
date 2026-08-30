import { AlertTriangle, Check, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { extractVariables } from '@/core/prompt/variableExtractor'
import {
  COPY_FORMATS,
  countUnfilled,
  renderAll,
  renderMessage,
  type CopyFormat,
} from '@/core/prompt/promptRenderer'
import type { Message, Prompt } from '@/core/prompt/promptModel'
import { cn } from '@/lib/utils'

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

  async function copy(text: string, key: string) {
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
              variables.map((name) => (
                <div key={name} className="flex flex-col gap-1">
                  <Label htmlFor={`var-${name}`} className="font-mono text-xs">
                    {`{{${name}}}`}
                  </Label>
                  <Input
                    id={`var-${name}`}
                    value={effectiveValues[name]}
                    placeholder={prompt.variables[name]?.description ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                  />
                </div>
              ))
            )}
            {unfilled > 0 && (
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
