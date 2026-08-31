import { CalendarClock, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useRunbookStore } from '@/stores/runbookStore'
import { currentSpec, type ArgSpec, type Runbook, type RunSchedule } from '@/core/runbook/runbookModel'
import { cronNextRuns, describeCron, isValidCron } from '@/core/runbook/cron'
import { cn } from '@/lib/utils'
import { SecretPicker } from './SecretPicker'

type Draft = Partial<RunSchedule>

const PRESETS = ['*/15 * * * *', '0 * * * *', '0 9 * * 1-5', '@daily', '@weekly']

export function SchedulesView() {
  const runbooks = useRunbookStore((s) => s.runbooks)
  const schedules = useRunbookStore((s) => s.schedules)
  const putSchedule = useRunbookStore((s) => s.putSchedule)
  const deleteSchedule = useRunbookStore((s) => s.deleteSchedule)

  const [editing, setEditing] = useState<Draft | null>(null)
  const published = useMemo(() => runbooks.filter((r) => r.published), [runbooks])

  function nameOf(id: string) {
    const rb = runbooks.find((r) => r.id === id)
    return rb ? currentSpec(rb)?.name ?? rb.slug : id
  }

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <CalendarClock className="size-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Cron-triggered runs. Only <span className="font-medium">published</span> runbooks run on a schedule.
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          disabled={published.length === 0}
          onClick={() => setEditing({ cron: '@daily', enabled: true, args: {}, version: 0 })}
        >
          <Plus className="size-4" /> Schedule
        </Button>
      </div>

      {published.length === 0 && (
        <p className="mb-3 text-xs text-muted-foreground">Publish a runbook first — drafts cannot be scheduled.</p>
      )}

      {schedules.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No schedules yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {schedules.map((sc) => (
            <li key={sc.id} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm">
              <Switch
                checked={sc.enabled}
                onCheckedChange={(v) => void putSchedule({ ...sc, enabled: v === true })}
                aria-label={sc.enabled ? 'Disable schedule' : 'Enable schedule'}
              />
              <div className="min-w-0 flex-1">
                <span className="font-medium">{nameOf(sc.runbookId)}</span>{' '}
                <span className="font-mono text-xs text-muted-foreground">{sc.cron}</span>
                <div className="text-[11px] text-muted-foreground">
                  {describeCron(sc.cron)}
                  {sc.enabled && sc.nextRunAt > 0 && <> · next {new Date(sc.nextRunAt).toLocaleString()}</>}
                  {sc.lastRunAt > 0 && (
                    <>
                      {' '}
                      · last{' '}
                      <span
                        className={cn(
                          sc.lastStatus === 'ok' && 'text-emerald-600 dark:text-emerald-500',
                          (sc.lastStatus === 'failed' || sc.lastStatus === 'error') && 'text-destructive',
                        )}
                      >
                        {sc.lastStatus ?? '—'}
                      </span>{' '}
                      {new Date(sc.lastRunAt).toLocaleString()}
                    </>
                  )}
                  {sc.lastError && <span className="text-destructive"> · {sc.lastError}</span>}
                </div>
              </div>
              <Button size="xs" variant="ghost" onClick={() => setEditing(sc)}>
                Edit
              </Button>
              <button
                type="button"
                aria-label="Delete schedule"
                onClick={() => void deleteSchedule(sc.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ScheduleDialog
        key={editing?.id ?? (editing ? 'new' : 'closed')}
        draft={editing}
        published={published}
        argSpecFor={(id) => {
          const rb = runbooks.find((r) => r.id === id)
          return rb ? currentSpec(rb)?.args ?? [] : []
        }}
        onClose={() => setEditing(null)}
        onSave={async (d) => {
          await putSchedule(d)
          setEditing(null)
        }}
      />
    </div>
  )
}

interface DialogProps {
  draft: Draft | null
  published: Runbook[]
  argSpecFor: (runbookId: string) => ArgSpec[]
  onClose: () => void
  onSave: (d: Draft) => Promise<void>
}

function ScheduleDialog({ draft, published, argSpecFor, onClose, onSave }: DialogProps) {
  const [d, setD] = useState<Draft | null>(draft)

  const runbookId = d?.runbookId ?? ''
  const cron = d?.cron ?? ''
  const cronOk = isValidCron(cron)
  const nextRuns = cronOk ? cronNextRuns(cron, 3) : []
  const args = runbookId ? argSpecFor(runbookId) : []

  return (
    <Dialog open={draft != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{draft?.id ? 'Edit schedule' : 'New schedule'}</DialogTitle>
        </DialogHeader>
        {d && (
          <form
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
            onSubmit={async (e) => {
              e.preventDefault()
              if (cronOk && runbookId) await onSave(d)
            }}
          >
            <div>
              <Label className="text-xs">Runbook</Label>
              <Select value={runbookId} onValueChange={(v) => v && setD((c) => ({ ...c!, runbookId: v }))}>
                <SelectTrigger size="sm">
                  <SelectValue placeholder="Pick a published runbook" />
                </SelectTrigger>
                <SelectContent>
                  {published.map((rb) => (
                    <SelectItem key={rb.id} value={rb.id}>
                      {currentSpec(rb)?.name ?? rb.slug}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Cron expression</Label>
              <Input
                value={cron}
                onChange={(e) => setD((c) => ({ ...c!, cron: e.target.value }))}
                placeholder="*/15 * * * *  or  @daily"
                className={cn('font-mono', !cronOk && cron && 'border-destructive')}
              />
              <div className="mt-1 flex flex-wrap gap-1">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setD((c) => ({ ...c!, cron: p }))}
                    className="rounded bg-accent/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-accent"
                  >
                    {p}
                  </button>
                ))}
              </div>
              {cron && !cronOk && <p className="mt-1 text-xs text-destructive">Not a valid cron expression.</p>}
              {cronOk && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {describeCron(cron)} — next: {nextRuns.map((r) => r.toLocaleString()).join(' · ') || 'never'}
                </p>
              )}
            </div>

            {args.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium tracking-wide text-muted-foreground">ARGUMENTS</p>
                {args.map((a) => (
                  <div key={a.name} className="flex flex-col gap-1">
                    <Label className="font-mono text-xs">
                      {a.label || a.name}
                      {a.required && <span className="text-destructive"> *</span>}
                    </Label>
                    {a.type === 'secret' ? (
                      <SecretPicker
                        by="name"
                        value={d.args?.[a.name] ?? ''}
                        onChange={(v) => setD((c) => ({ ...c!, args: { ...c!.args, [a.name]: v } }))}
                      />
                    ) : a.type === 'enum' && (a.enumValues?.length ?? 0) > 0 ? (
                      <select
                        value={d.args?.[a.name] ?? ''}
                        onChange={(e) => setD((c) => ({ ...c!, args: { ...c!.args, [a.name]: e.target.value } }))}
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
                        value={d.args?.[a.name] ?? ''}
                        placeholder={a.help}
                        onChange={(e) => setD((c) => ({ ...c!, args: { ...c!.args, [a.name]: e.target.value } }))}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={d.enabled ?? true}
                onCheckedChange={(v) => setD((c) => ({ ...c!, enabled: v === true }))}
              />
              Enabled
            </label>

            <DialogFooter>
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <Button type="submit" disabled={!cronOk || !runbookId}>
                Save
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
