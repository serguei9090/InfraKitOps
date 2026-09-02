import { useEffect, useMemo, useState } from 'react'
import { Boxes, Download, FileText, RefreshCw, Save, ServerCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import * as api from '@/adapters/backend/ansibleClient'
import { listNodes } from '@/adapters/backend/runbookClient'
import type { SshNode } from '@/core/runbook/runbookModel'
import { useAnsibleStore } from '@/stores/ansibleStore'

const Err = ({ msg }: { msg: string | null }) =>
  msg ? <p className="rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-400">{msg}</p> : null

export function InventoryView() {
  const selectedId = useAnsibleStore((s) => s.selectedId)
  const tree = useAnsibleStore((s) => s.tree)
  const inventory = useAnsibleStore((s) => s.inventory)
  const error = useAnsibleStore((s) => s.inventoryError)
  const load = useAnsibleStore((s) => s.loadInventory)

  const invFiles = useMemo(() => tree?.inventories ?? [], [tree])
  const [src, setSrc] = useState('')

  useEffect(() => {
    if (selectedId) void load(src || undefined)
  }, [selectedId, src, load])

  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a project on the Projects tab first
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 gap-4 p-5 lg:grid-cols-2">
      <div className="min-h-0 space-y-3 overflow-auto">
        <div className="flex items-center gap-2">
          <Select value={src || '(default)'} onValueChange={(v) => setSrc(v === '(default)' || !v ? '' : v)}>
            <SelectTrigger size="sm" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="(default)">(project default)</SelectItem>
              {invFiles.map((i) => (
                <SelectItem key={i} value={i}>
                  {i}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => void load(src || undefined)}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <ImportNodesDialog />
        </div>

        <Err msg={error} />

        {inventory && (
          <>
            <div className="rounded-lg border border-border/60 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
                <Boxes className="size-3.5" /> Groups
              </div>
              {Object.keys(inventory.groups).length === 0 ? (
                <p className="text-xs text-muted-foreground">No groups.</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(inventory.groups).map(([g, hosts]) => (
                    <div key={g}>
                      <div className="text-sm font-medium">{g}</div>
                      <ul className="ml-3 space-y-0.5">
                        {hosts.map((h) => (
                          <li key={h} className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                            <ServerCog className="size-3" /> {h}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {inventory.graph && (
              <div className="rounded-lg border border-border/60 p-3">
                <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">--graph</div>
                <pre className="overflow-auto font-mono text-xs leading-relaxed">{inventory.graph}</pre>
              </div>
            )}
          </>
        )}
      </div>

      <div className="min-h-0">
        <FileEditor projectId={selectedId} files={invFiles} onSaved={() => void load(src || undefined)} />
      </div>
    </div>
  )
}

function FileEditor({
  projectId,
  files,
  onSaved,
}: {
  projectId: string
  files: string[]
  onSaved: () => void
}) {
  const [path, setPath] = useState(files[0] ?? 'inventory/hosts.ini')
  const [content, setContent] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setLoaded(false)
    setErr(null)
    api
      .readProjectFile(projectId, path)
      .then((r) => {
        setContent(r.content)
        setDirty(false)
        setLoaded(true)
      })
      .catch((e) => {
        setContent('')
        setLoaded(true)
        setErr(e instanceof Error ? e.message : String(e))
      })
  }, [projectId, path])

  async function save() {
    try {
      await api.writeProjectFile(projectId, path, content)
      setDirty(false)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-border/60">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <FileText className="size-4 text-muted-foreground" />
        <Select value={path} onValueChange={(v) => v && setPath(v)}>
          <SelectTrigger size="sm" className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...new Set([...files, 'inventory/hosts.ini', 'ansible.cfg', 'group_vars/all.yml'])].map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={save} disabled={!dirty}>
          <Save className="size-4" /> Save
        </Button>
      </div>
      {err && (
        <div className="px-3 pt-2">
          <Err msg={err} />
        </div>
      )}
      <Textarea
        className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-xs focus-visible:ring-0"
        value={loaded ? content : 'loading…'}
        onChange={(e) => {
          setContent(e.target.value)
          setDirty(true)
        }}
        spellCheck={false}
      />
    </div>
  )
}

function ImportNodesDialog() {
  const selectedId = useAnsibleStore((s) => s.selectedId)!
  const tree = useAnsibleStore((s) => s.tree)
  const loadInv = useAnsibleStore((s) => s.loadInventory)
  const [open, setOpen] = useState(false)
  const [nodes, setNodes] = useState<SshNode[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [group, setGroup] = useState('imported')
  const [file, setFile] = useState(tree?.inventories?.[0] ?? 'inventory/hosts.ini')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (open) listNodes().then(setNodes).catch(() => setNodes([]))
  }, [open])

  const iniBlock = useMemo(() => {
    const lines = nodes
      .filter((n) => picked.has(n.id))
      .map((n) => {
        const parts = [n.host, `ansible_host=${n.host}`, `ansible_user=${n.user}`]
        if (n.port && n.port !== 22) parts.push(`ansible_port=${n.port}`)
        return parts.join(' ')
      })
    return `\n[${group || 'imported'}]\n${lines.join('\n')}\n`
  }, [nodes, picked, group])

  async function append() {
    setErr(null)
    try {
      let existing = ''
      try {
        existing = (await api.readProjectFile(selectedId, file)).content
      } catch {
        /* new file */
      }
      await api.writeProjectFile(selectedId, file, existing.trimEnd() + '\n' + iniBlock)
      setOpen(false)
      setPicked(new Set())
      void loadInv()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Download className="size-4" /> Import from SSH Nodes
          </Button>
        }
      />
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Import hosts from SSH Nodes</DialogTitle>
        </DialogHeader>
        <Err msg={err} />
        {nodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No SSH nodes registered (Runbooks → Nodes).
          </p>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-1 overflow-auto rounded-md border border-border/50 p-2">
              {nodes.map((n) => (
                <label key={n.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.has(n.id)}
                    onChange={(e) => {
                      const next = new Set(picked)
                      if (e.target.checked) next.add(n.id)
                      else next.delete(n.id)
                      setPicked(next)
                    }}
                  />
                  <span className="font-medium">{n.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {n.user}@{n.host}:{n.port}
                  </span>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Group name</Label>
                <input
                  className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Append to</Label>
                <Select value={file} onValueChange={(v) => v && setFile(v)}>
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...new Set([...(tree?.inventories ?? []), 'inventory/hosts.ini'])].map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <pre className="max-h-32 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px]">{iniBlock}</pre>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={append} disabled={picked.size === 0}>
                Append {picked.size || ''}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
