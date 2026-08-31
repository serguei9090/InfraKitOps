import { AlertTriangle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { previewRun } from '@/adapters/backend/runbookClient'
import { currentSpec, type Preview, type Runbook } from '@/core/runbook/runbookModel'
import { useRunbookStore } from '@/stores/runbookStore'
import { cn } from '@/lib/utils'
import { SecretPicker } from './SecretPicker'

interface Props {
  runbook: Runbook
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Fill args → dry-run/confirm → Run. R0 version: text inputs for every arg,
 * a live redacted preview from the backend, destructive warnings, dry-run and
 * "run as author" toggles. The full per-type inputs + vault picker land in R2.
 */
export function RunSetupDialog({ runbook, open, onOpenChange }: Props) {
  const spec = currentSpec(runbook)
  const startRun = useRunbookStore((s) => s.startRun)

  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    for (const a of spec?.args ?? []) seed[a.name] = a.default ?? ''
    return seed
  })
  const [dryRun, setDryRun] = useState(false)
  const [asAuthor, setAsAuthor] = useState(!runbook.published)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)

  const missing = useMemo(
    () => (spec?.args ?? []).filter((a) => a.required && !values[a.name]?.trim()).map((a) => a.name),
    [spec, values],
  )

  async function refreshPreview() {
    setBusy(true)
    try {
      setPreview(await previewRun(runbook.id, values))
    } catch {
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  function fire() {
    startRun(runbook.id, { args: values, dryRun, asAuthor })
    onOpenChange(false)
  }

  if (!spec) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Run — {spec.name}</DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">ARGUMENTS</p>
            {spec.args.length === 0 ? (
              <p className="text-sm text-muted-foreground">This runbook takes no arguments.</p>
            ) : (
              spec.args.map((a) => (
                <div key={a.name} className="flex flex-col gap-1">
                  <Label htmlFor={`a-${a.name}`} className="font-mono text-xs">
                    {a.label || a.name}
                    {a.required && <span className="text-destructive"> *</span>}
                  </Label>
                  {a.type === 'secret' ? (
                    <SecretPicker
                      by="name"
                      value={values[a.name] ?? ''}
                      onChange={(v) => setValues((cur) => ({ ...cur, [a.name]: v }))}
                    />
                  ) : a.type === 'enum' && (a.enumValues?.length ?? 0) > 0 ? (
                    <select
                      id={`a-${a.name}`}
                      value={values[a.name] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [a.name]: e.target.value }))}
                      className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                    >
                      <option value="">—</option>
                      {a.enumValues!.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={`a-${a.name}`}
                      value={values[a.name] ?? ''}
                      placeholder={a.help}
                      onChange={(e) => setValues((v) => ({ ...v, [a.name]: e.target.value }))}
                    />
                  )}
                </div>
              ))
            )}
            <div className="mt-1 flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={dryRun} onCheckedChange={(v) => setDryRun(v === true)} />
                Dry run (resolve + validate, execute nothing)
              </label>
              {!runbook.published && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={asAuthor} onCheckedChange={(v) => setAsAuthor(v === true)} />
                  Run this draft as its author
                </label>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium tracking-wide text-muted-foreground">RESOLVED PAYLOAD</p>
              <Button size="xs" variant="outline" disabled={busy} onClick={() => void refreshPreview()}>
                {busy ? 'Resolving…' : 'Preview'}
              </Button>
            </div>
            {preview ? (
              <>
                {preview.validation.length > 0 && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                    {preview.validation.map((v) => (
                      <div key={v.arg}>{v.message}</div>
                    ))}
                  </div>
                )}
                {preview.destructive.length > 0 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
                    <p className="flex items-center gap-1 font-medium">
                      <AlertTriangle className="size-3.5" /> destructive patterns
                    </p>
                    {preview.destructive.map((d, i) => (
                      <div key={i}>
                        line {d.line}: <span className="font-mono">{d.pattern}</span> — {d.note}
                      </div>
                    ))}
                  </div>
                )}
                {preview.steps.map((st) => (
                  <div key={st.index} className="rounded-md border border-border/60 bg-card">
                    <div className="border-b border-border/60 px-2 py-1 text-xs font-medium">
                      {st.index}. {st.name} <span className="text-muted-foreground">· {st.executor}</span>
                    </div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words px-2 py-1.5 font-mono text-[12px]">
                      {st.command}
                    </pre>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Press Preview to see the exact commands (secrets masked).</p>
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {missing.length > 0 ? (
            <span className="text-xs text-muted-foreground">Fill: {missing.join(', ')}</span>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button
              className={cn(!dryRun && 'bg-primary')}
              disabled={missing.length > 0}
              onClick={fire}
            >
              {dryRun ? 'Dry run' : 'Run'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
