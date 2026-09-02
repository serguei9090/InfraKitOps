import { useMemo, useState } from 'react'
import {
  Eye,
  EyeOff,
  FileCode2,
  FolderGit2,
  FolderPlus,
  GitBranch,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SecretPicker } from '@/adapters/ui/runbook/SecretPicker'
import { useVaultStore } from '@/stores/vaultStore'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useAnsibleStore } from '@/stores/ansibleStore'
import type { RunSpec } from '@/core/ansible/ansibleModel'

export function ProjectsView() {
  const projects = useAnsibleStore((s) => s.projects)
  const selectedId = useAnsibleStore((s) => s.selectedId)
  const select = useAnsibleStore((s) => s.select)
  const remove = useAnsibleStore((s) => s.removeProject)
  const selected = projects.find((p) => p.id === selectedId) ?? null

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border/60">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Projects</span>
          <NewProjectDialog />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {projects.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No projects yet. Create one or add an existing folder.
            </p>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => void select(p.id)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                p.id === selectedId ? 'bg-primary/10 text-primary' : 'hover:bg-accent/40',
              )}
            >
              <FolderGit2 className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-auto">
        {selected ? (
          <ProjectDetail key={selected.id} onDelete={() => void remove(selected.id)} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a project
          </div>
        )}
      </section>
    </div>
  )
}

function ProjectDetail({ onDelete }: { onDelete: () => void }) {
  const projects = useAnsibleStore((s) => s.projects)
  const selectedId = useAnsibleStore((s) => s.selectedId)
  const tree = useAnsibleStore((s) => s.tree)
  const startRun = useAnsibleStore((s) => s.startRun)
  const pull = useAnsibleStore((s) => s.pullProject)
  const publish = useAnsibleStore((s) => s.publishProject)
  const p = projects.find((x) => x.id === selectedId)!

  const playbooks = tree?.playbooks ?? []
  const [playbook, setPlaybook] = useState('')
  const chosen = playbook || playbooks[0] || ''

  const [opts, setOpts] = useState({
    inventory: '',
    limit: '',
    tags: '',
    check: false,
    diff: false,
    become: false,
    verbosity: 0,
    extraVars: '',
  })
  const [showOpts, setShowOpts] = useState(false)

  const inventories = useMemo(() => tree?.inventories ?? [], [tree])

  function run() {
    if (!chosen) return
    const spec: RunSpec = {
      projectId: p.id,
      playbook: chosen,
      inventory: opts.inventory || undefined,
      limit: opts.limit || undefined,
      tags: opts.tags || undefined,
      extraVars: opts.extraVars || undefined,
      check: opts.check,
      diff: opts.diff,
      become: opts.become,
      verbosity: opts.verbosity,
    }
    startRun(spec)
  }

  return (
    <div className="space-y-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            {p.name}
            {p.source === 'git' && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                git
              </span>
            )}
            {p.published && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
                published
              </span>
            )}
          </h2>
          <p className="truncate font-mono text-xs text-muted-foreground">{p.path}</p>
          {p.git && (
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {p.git.url}
              {p.git.ref ? `@${p.git.ref}` : ''}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {p.source === 'git' && (
            <Button variant="ghost" size="sm" onClick={() => void pull(p.id)}>
              <RefreshCw className="size-4" /> Pull
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void publish(p.id, !p.published)}>
            {p.published ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {p.published ? 'Unpublish' : 'Publish'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="size-4" /> Remove
          </Button>
        </div>
      </div>

      {tree && (
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
          <span>{playbooks.length} playbooks</span>
          <span>{tree.roles.length} roles</span>
          <span>{tree.collections.length} collections</span>
          <span>{inventories.length} inventories</span>
        </div>
      )}

      <div className="rounded-lg border border-border/60 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Play className="size-4" /> Run a playbook
        </div>
        {playbooks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No playbooks found in this project. Add a <code className="text-xs">*.yml</code> file whose
            top level is a list of plays.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={chosen} onValueChange={(v) => v && setPlaybook(v)}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="playbook" />
                </SelectTrigger>
                <SelectContent>
                  {playbooks.map((pb) => (
                    <SelectItem key={pb} value={pb}>
                      <span className="flex items-center gap-1.5">
                        <FileCode2 className="size-3.5" />
                        {pb}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={run} disabled={!chosen}>
                <Play className="size-4" /> Run
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowOpts((v) => !v)}>
                <Settings2 className="size-4" /> Options
              </Button>
            </div>

            {showOpts && (
              <div className="space-y-3 rounded-md bg-muted/30 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Inventory</Label>
                    {inventories.length > 0 ? (
                      <Select
                        value={opts.inventory}
                        onValueChange={(v) => setOpts((o) => ({ ...o, inventory: v && v !== '(default)' ? v : '' }))}
                      >
                        <SelectTrigger size="sm">
                          <SelectValue placeholder="(from ansible.cfg)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="(default)">(from ansible.cfg)</SelectItem>
                          {inventories.map((i) => (
                            <SelectItem key={i} value={i}>
                              {i}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        className="h-8 text-xs"
                        value={opts.inventory}
                        onChange={(e) => setOpts((o) => ({ ...o, inventory: e.target.value }))}
                        placeholder="path or host,"
                      />
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Limit</Label>
                    <Input
                      className="h-8 text-xs"
                      value={opts.limit}
                      onChange={(e) => setOpts((o) => ({ ...o, limit: e.target.value }))}
                      placeholder="host pattern"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Tags</Label>
                    <Input
                      className="h-8 text-xs"
                      value={opts.tags}
                      onChange={(e) => setOpts((o) => ({ ...o, tags: e.target.value }))}
                      placeholder="tag1,tag2"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Verbosity</Label>
                    <Select
                      value={String(opts.verbosity)}
                      onValueChange={(v) => v && setOpts((o) => ({ ...o, verbosity: Number(v) }))}
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
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={opts.check}
                      onCheckedChange={(c) => setOpts((o) => ({ ...o, check: c === true }))}
                    />
                    --check
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={opts.diff}
                      onCheckedChange={(c) => setOpts((o) => ({ ...o, diff: c === true }))}
                    />
                    --diff
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={opts.become}
                      onCheckedChange={(c) => setOpts((o) => ({ ...o, become: c === true }))}
                    />
                    --become
                  </label>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Extra vars (YAML / JSON)</Label>
                  <Textarea
                    className="font-mono text-xs"
                    rows={3}
                    value={opts.extraVars}
                    onChange={(e) => setOpts((o) => ({ ...o, extraVars: e.target.value }))}
                    placeholder={'key: value'}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {tree && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TreeList title="Playbooks" items={playbooks} icon={FileCode2} />
          <TreeList title="Roles" items={tree.roles} icon={FolderGit2} />
          <TreeList title="Collections" items={tree.collections} icon={FolderGit2} />
          <TreeList title="Inventories" items={inventories} icon={FolderGit2} />
        </div>
      )}
    </div>
  )
}

function TreeList({
  title,
  items,
  icon: Icon,
}: {
  title: string
  items: string[]
  icon: typeof FileCode2
}) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((i) => (
            <li key={i} className="flex items-center gap-1.5 font-mono text-xs">
              <Icon className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{i}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NewProjectDialog() {
  const add = useAnsibleStore((s) => s.addProject)
  const settings = useAnsibleStore((s) => s.settings)
  const vaultUnlocked = useVaultStore((s) => s.status?.unlocked ?? false)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'new' | 'existing' | 'git'>('new')
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [gitUrl, setGitUrl] = useState('')
  const [gitRef, setGitRef] = useState('')
  const [gitSecret, setGitSecret] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const p = await add({
      name: name.trim(),
      mode,
      path: path.trim() || undefined,
      gitUrl: gitUrl.trim() || undefined,
      gitRef: gitRef.trim() || undefined,
      gitSecret: gitSecret || undefined,
    })
    setBusy(false)
    if (p) {
      setOpen(false)
      setName('')
      setPath('')
      setGitUrl('')
      setGitRef('')
      setGitSecret('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="New project">
            <Plus className="size-4" />
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a project</DialogTitle>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === 'new' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('new')}
            >
              <FolderPlus className="size-4" /> New
            </Button>
            <Button
              type="button"
              variant={mode === 'existing' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('existing')}
            >
              <FolderGit2 className="size-4" /> Existing
            </Button>
            <Button
              type="button"
              variant={mode === 'git' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('git')}
            >
              <GitBranch className="size-4" /> Git
            </Button>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ap-name">Name</Label>
            <Input id="ap-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>

          {mode === 'new' && (
            <p className="text-xs text-muted-foreground">
              Scaffolds a fresh layout under{' '}
              <code className="text-xs">{settings?.workspaceDir || settings?.defaultWorkspace}</code>.
            </p>
          )}
          {mode === 'existing' && (
            <div className="space-y-1">
              <Label htmlFor="ap-path">Absolute path</Label>
              <Input
                id="ap-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/home/me/infra/site"
                required
              />
            </div>
          )}
          {mode === 'git' && (
            <>
              <div className="space-y-1">
                <Label htmlFor="ap-git">Repository URL</Label>
                <Input
                  id="ap-git"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  placeholder="https://github.com/org/ansible.git"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ap-ref">Branch / tag (optional)</Label>
                <Input id="ap-ref" value={gitRef} onChange={(e) => setGitRef(e.target.value)} placeholder="main" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Token (private https repos — an InfraKit Vault secret)</Label>
                {vaultUnlocked ? (
                  <SecretPicker value={gitSecret} onChange={setGitSecret} by="id" placeholder="none (public repo)" />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Public repo, or unlock the Vault to pick a token.
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Clones into <code className="text-xs">{settings?.workspaceDir || settings?.defaultWorkspace}</code>.
                SSH URLs use your agent.
              </p>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                !name.trim() ||
                (mode === 'existing' && !path.trim()) ||
                (mode === 'git' && !gitUrl.trim())
              }
            >
              {busy && mode === 'git' ? 'Cloning…' : 'Add'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
