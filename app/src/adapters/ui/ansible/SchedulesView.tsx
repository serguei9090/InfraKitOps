import { useState } from 'react'
import { CalendarClock, CheckCircle2, Pencil, Plus, Trash2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { describeCron } from '@/core/runbook/cron'
import { useAnsibleStore } from '@/stores/ansibleStore'
import type { Schedule } from '@/core/ansible/ansibleModel'

const PRESETS = ['@hourly', '@daily', '@weekly', '0 3 * * *', '*/15 * * * *']

export function SchedulesView() {
  const selectedId = useAnsibleStore((s) => s.selectedId)
  const jobs = useAnsibleStore((s) => s.jobs)
  const schedules = useAnsibleStore((s) => s.schedules)
  const save = useAnsibleStore((s) => s.saveSchedule)
  const remove = useAnsibleStore((s) => s.removeSchedule)
  const [editing, setEditing] = useState<Partial<Schedule> | null>(null)

  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a project on the Projects tab first
      </div>
    )
  }

  const jobName = (id: string) => jobs.find((j) => j.id === id)?.name ?? '(job deleted)'

  return (
    <div className="grid h-full min-h-0 gap-4 p-5 lg:grid-cols-[1fr_minmax(300px,380px)]">
      <div className="min-h-0 overflow-auto">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Scheduled jobs</span>
          <Button
            size="sm"
            variant="outline"
            disabled={jobs.length === 0}
            onClick={() => setEditing({ jobId: jobs[0]?.id, name: '', cron: '@daily', enabled: true })}
          >
            <Plus className="size-4" /> New schedule
          </Button>
        </div>
        {jobs.length === 0 && (
          <p className="text-sm text-muted-foreground">Create a Job first — a schedule fires a Job.</p>
        )}
        {schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No schedules.</p>
        ) : (
          <ul className="space-y-2">
            {schedules.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-lg border border-border/60 px-4 py-2.5">
                <CalendarClock className={s.enabled ? 'size-4 text-primary' : 'size-4 text-muted-foreground'} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name || jobName(s.jobId)}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {s.cron} · {describeCron(s.cron)} · {jobName(s.jobId)}
                  </div>
                  {s.lastStatus && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs">
                      {s.lastStatus === 'ok' ? (
                        <CheckCircle2 className="size-3 text-emerald-500" />
                      ) : (
                        <XCircle className="size-3 text-red-500" />
                      )}
                      last: {s.lastStatus}
                      {s.lastError ? ` — ${s.lastError}` : ''}
                    </div>
                  )}
                </div>
                <Button size="icon" variant="ghost" onClick={() => setEditing(s)} aria-label="Edit">
                  <Pencil className="size-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => void remove(s.id)} aria-label="Delete">
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <form
          key={editing.id ?? 'new'}
          className="h-fit space-y-3 rounded-lg border border-border/60 p-4"
          onSubmit={async (e) => {
            e.preventDefault()
            const saved = await save(editing)
            if (saved) setEditing(null)
          }}
        >
          <div className="text-sm font-semibold">{editing.id ? 'Edit schedule' : 'New schedule'}</div>
          <div className="space-y-1">
            <Label className="text-xs">Job</Label>
            <Select
              value={editing.jobId ?? ''}
              onValueChange={(v) => v && setEditing((p) => ({ ...p, jobId: v }))}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="pick a job" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Name (optional)</Label>
            <Input
              className="h-8 text-xs"
              value={editing.name ?? ''}
              onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cron (5-field or @daily)</Label>
            <Input
              className="h-8 font-mono text-xs"
              value={editing.cron ?? ''}
              onChange={(e) => setEditing((p) => ({ ...p, cron: e.target.value }))}
            />
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setEditing((e) => ({ ...e, cron: p }))}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:bg-accent"
                >
                  {p}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{describeCron(editing.cron ?? '')}</p>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={editing.enabled ?? false}
              onCheckedChange={(c) => setEditing((p) => ({ ...p, enabled: c }))}
            />
            Enabled
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={editing.runOnStart ?? false}
              onCheckedChange={(c) => setEditing((p) => ({ ...p, runOnStart: c }))}
            />
            Run once when the app / backend starts
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!editing.jobId || !editing.cron?.trim()}>
              Save
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
