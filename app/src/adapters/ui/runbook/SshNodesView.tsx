import { CheckCircle2, Network, Plus, ShieldAlert, Trash2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { testNode, type NodeTestResult } from '@/adapters/backend/runbookClient'
import { SaveAsMonitorButton } from '@/adapters/ui/monitor/SaveAsMonitorButton'
import { useRunbookStore } from '@/stores/runbookStore'
import type { SshNode } from '@/core/runbook/runbookModel'
import { SecretPicker } from './SecretPicker'
import { cn } from '@/lib/utils'

type Draft = Partial<SshNode>

export function SshNodesView() {
  const nodes = useRunbookStore((s) => s.nodes)
  const putNode = useRunbookStore((s) => s.putNode)
  const deleteNode = useRunbookStore((s) => s.deleteNode)
  const refreshNodes = useRunbookStore((s) => s.refreshNodes)

  const [editing, setEditing] = useState<Draft | null>(null)
  const [tests, setTests] = useState<Record<string, NodeTestResult | 'running'>>({})

  async function runTest(id: string) {
    setTests((t) => ({ ...t, [id]: 'running' }))
    try {
      const r = await testNode(id)
      setTests((t) => ({ ...t, [id]: r }))
      void refreshNodes()
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, hostKeyFp: '', hostKeyLearned: false, hostKeyMismatch: false, error: String(e) } }))
    }
  }

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Network className="size-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">SSH targets for SSH steps</span>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setEditing({ port: 22, authKind: 'password', tags: [] })}>
          <Plus className="size-4" /> Node
        </Button>
      </div>

      {nodes.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No nodes yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {nodes.map((n) => {
            const test = tests[n.id]
            return (
              <li key={n.id} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{n.name}</span>{' '}
                  <span className="text-muted-foreground">
                    {n.user}@{n.host}:{n.port} · {n.authKind}
                  </span>
                  {n.hostKeyFp && (
                    <div className="truncate font-mono text-[11px] text-muted-foreground">host key {n.hostKeyFp}</div>
                  )}
                </div>
                {test === 'running' && <span className="text-xs text-muted-foreground">testing…</span>}
                {test && test !== 'running' && (
                  <span className={cn('flex items-center gap-1 text-xs', test.ok ? 'text-emerald-600 dark:text-emerald-500' : 'text-destructive')}>
                    {test.hostKeyMismatch ? (
                      <>
                        <ShieldAlert className="size-3.5" /> host key changed
                      </>
                    ) : test.ok ? (
                      <>
                        <CheckCircle2 className="size-3.5" /> {test.hostKeyLearned ? 'connected · key pinned' : 'connected'}
                      </>
                    ) : (
                      <>
                        <XCircle className="size-3.5" /> {test.error || 'failed'}
                      </>
                    )}
                  </span>
                )}
                <Button size="xs" variant="outline" onClick={() => void runTest(n.id)}>
                  Test
                </Button>
                <SaveAsMonitorButton
                  kind="ssh"
                  target=""
                  name={`node: ${n.name}`}
                  config={{ nodeId: n.id, command: 'true', assert: 'exit0' }}
                  label="Monitor"
                  size="xs"
                />
                <Button size="xs" variant="ghost" onClick={() => setEditing(n)}>
                  Edit
                </Button>
                <button
                  type="button"
                  aria-label={`Delete ${n.name}`}
                  onClick={() => void deleteNode(n.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit node' : 'New node'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <form
              className="flex flex-col gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                await putNode(editing)
                setEditing(null)
              }}
            >
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={editing.name ?? ''}
                    onChange={(e) => setEditing((d) => ({ ...d!, name: e.target.value }))}
                    autoFocus
                  />
                </div>
                <div className="w-20">
                  <Label className="text-xs">Port</Label>
                  <Input
                    type="number"
                    value={editing.port ?? 22}
                    onChange={(e) => setEditing((d) => ({ ...d!, port: Number(e.target.value) || 22 }))}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Host</Label>
                  <Input
                    value={editing.host ?? ''}
                    onChange={(e) => setEditing((d) => ({ ...d!, host: e.target.value }))}
                  />
                </div>
                <div className="w-32">
                  <Label className="text-xs">User</Label>
                  <Input
                    value={editing.user ?? ''}
                    onChange={(e) => setEditing((d) => ({ ...d!, user: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Auth</Label>
                <div className="flex gap-2">
                  <Select
                    value={editing.authKind ?? 'password'}
                    onValueChange={(v) => v && setEditing((d) => ({ ...d!, authKind: v as SshNode['authKind'] }))}
                  >
                    <SelectTrigger size="sm" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="password">password</SelectItem>
                      <SelectItem value="key">private key</SelectItem>
                      <SelectItem value="agent">ssh-agent</SelectItem>
                    </SelectContent>
                  </Select>
                  {editing.authKind !== 'agent' && (
                    <div className="flex-1">
                      <SecretPicker
                        value={editing.authSecretId ?? ''}
                        onChange={(id) => setEditing((d) => ({ ...d!, authSecretId: id }))}
                        kinds={editing.authKind === 'key' ? ['ssh-key'] : ['password']}
                      />
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <DialogClose render={<Button variant="outline">Cancel</Button>} />
                <Button type="submit" disabled={!editing.name || !editing.host || !editing.user}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
