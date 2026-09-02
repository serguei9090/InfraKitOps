import { useState } from 'react'
import { ListChecks, Pencil, Play, Plus, Trash2 } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { useAnsibleStore } from '@/stores/ansibleStore'
import type { Job } from '@/core/ansible/ansibleModel'

const blank = (projectId: string): Partial<Job> => ({
  projectId,
  name: '',
  playbook: '',
  verbosity: 0,
})

export function JobsView() {
  const selectedId = useAnsibleStore((s) => s.selectedId)
  const jobs = useAnsibleStore((s) => s.jobs)
  const tree = useAnsibleStore((s) => s.tree)
  const saveJob = useAnsibleStore((s) => s.saveJob)
  const removeJob = useAnsibleStore((s) => s.removeJob)
  const startJobRun = useAnsibleStore((s) => s.startJobRun)
  const [editing, setEditing] = useState<Partial<Job> | null>(null)

  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a project on the Projects tab first
      </div>
    )
  }

  const playbooks = tree?.playbooks ?? []

  return (
    <div className="grid h-full min-h-0 gap-4 p-5 lg:grid-cols-[1fr_minmax(320px,420px)]">
      <div className="min-h-0 overflow-auto">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Saved jobs</span>
          <Button size="sm" variant="outline" onClick={() => setEditing(blank(selectedId))}>
            <Plus className="size-4" /> New job
          </Button>
        </div>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No jobs yet. A job is a saved run config — playbook + inventory + tags + flags.
          </p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((j) => (
              <li
                key={j.id}
                className="flex items-center gap-3 rounded-lg border border-border/60 px-4 py-2.5"
              >
                <ListChecks className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{j.name}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {j.playbook}
                    {j.tags ? ` · tags:${j.tags}` : ''}
                    {j.limit ? ` · limit:${j.limit}` : ''}
                    {j.check ? ' · check' : ''}
                  </div>
                </div>
                <Button size="sm" onClick={() => startJobRun(j.id, selectedId)}>
                  <Play className="size-4" /> Run
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setEditing(j)} aria-label="Edit">
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void removeJob(j.id)}
                  aria-label="Delete"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <JobForm
          key={editing.id ?? 'new'}
          job={editing}
          playbooks={playbooks}
          inventories={tree?.inventories ?? []}
          onCancel={() => setEditing(null)}
          onSave={async (j) => {
            const saved = await saveJob(j)
            if (saved) setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function JobForm({
  job,
  playbooks,
  inventories,
  onCancel,
  onSave,
}: {
  job: Partial<Job>
  playbooks: string[]
  inventories: string[]
  onCancel: () => void
  onSave: (j: Partial<Job>) => void
}) {
  const [j, setJ] = useState<Partial<Job>>(job)
  const patch = (p: Partial<Job>) => setJ((prev) => ({ ...prev, ...p }))

  return (
    <form
      className="h-full space-y-3 overflow-auto rounded-lg border border-border/60 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(j)
      }}
    >
      <div className="text-sm font-semibold">{job.id ? 'Edit job' : 'New job'}</div>

      <div className="space-y-1">
        <Label className="text-xs">Name</Label>
        <Input value={j.name ?? ''} onChange={(e) => patch({ name: e.target.value })} required autoFocus />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Playbook</Label>
        <Select value={j.playbook ?? ''} onValueChange={(v) => v && patch({ playbook: v })}>
          <SelectTrigger size="sm">
            <SelectValue placeholder="playbook" />
          </SelectTrigger>
          <SelectContent>
            {playbooks.map((pb) => (
              <SelectItem key={pb} value={pb}>
                {pb}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Inventory</Label>
          <Select
            value={j.inventory || '(default)'}
            onValueChange={(v) => patch({ inventory: v && v !== '(default)' ? v : '' })}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="(default)">(default)</SelectItem>
              {inventories.map((i) => (
                <SelectItem key={i} value={i}>
                  {i}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Limit</Label>
          <Input
            className="h-8 text-xs"
            value={j.limit ?? ''}
            onChange={(e) => patch({ limit: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tags</Label>
          <Input
            className="h-8 text-xs"
            value={j.tags ?? ''}
            onChange={(e) => patch({ tags: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Verbosity</Label>
          <Select
            value={String(j.verbosity ?? 0)}
            onValueChange={(v) => v && patch({ verbosity: Number(v) })}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3, 4].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n === 0 ? 'normal' : `-${'v'.repeat(n)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        {(['check', 'diff', 'become'] as const).map((k) => (
          <label key={k} className="flex items-center gap-1.5 text-xs">
            <Checkbox checked={!!j[k]} onCheckedChange={(c) => patch({ [k]: c === true })} />
            --{k}
          </label>
        ))}
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Extra vars (YAML / JSON)</Label>
        <Textarea
          className="font-mono text-xs"
          rows={3}
          value={j.extraVars ?? ''}
          onChange={(e) => patch({ extraVars: e.target.value })}
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!j.name?.trim() || !j.playbook?.trim()}>
          Save job
        </Button>
      </div>
    </form>
  )
}
