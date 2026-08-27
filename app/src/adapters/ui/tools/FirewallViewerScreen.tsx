import { ArrowDownToLine, ArrowUpFromLine, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { backendGet } from '@/adapters/backend/backendClient'
import {
  firewallChange,
  type FirewallChangeOp,
  type FirewallRuleSpec,
} from '@/adapters/backend/firewallClient'
import {
  NetworkResultTable,
  NetworkToolScaffold,
  QueryBar,
  StatusStrip,
  useNetworkRun,
  type ResultColumn,
} from '@/adapters/ui/network'
import { useBackendStore } from '@/stores/backendStore'
import { runToEnvelope } from '@/core/network/history'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { RunEnvelope } from '@/core/network/history'
import type { FirewallResult, FirewallRule } from '@/core/network/toolResults'

const EMPTY_RULE: FirewallRuleSpec = {
  name: '',
  direction: 'inbound',
  action: 'allow',
  protocol: 'tcp',
  localPort: '',
  remoteAddr: '',
  enabled: true,
}

export function FirewallViewerScreen() {
  const [filter, setFilter] = useState('')
  const [dir, setDir] = useState<'all' | 'inbound' | 'outbound'>('all')
  const [action, setAction] = useState<'all' | 'allow' | 'block'>('all')

  const editable = useBackendStore((s) => s.capabilities?.capabilities['firewall-edit']?.available ?? false)

  const run = useCallback(async (signal: AbortSignal): Promise<RunEnvelope> => {
    const { envelope } = await backendGet<{ envelope: RunEnvelope }>('/firewall-viewer', signal)
    return envelope
  }, [])

  const { running, error, result, completions, start, restore } = useNetworkRun<FirewallResult>({ run })

  // --- editing state ---
  const [liveResult, setLiveResult] = useState<FirewallResult | null>(null)
  const shown = liveResult ?? result
  const [addOpen, setAddOpen] = useState(false)
  const [draft, setDraft] = useState<FirewallRuleSpec>(EMPTY_RULE)
  const [pending, setPending] = useState<{ op: FirewallChangeOp; rule: FirewallRuleSpec; warnings: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [changeError, setChangeError] = useState<string | null>(null)

  const applyChange = useCallback(
    async (op: FirewallChangeOp, rule: FirewallRuleSpec, confirmed: boolean) => {
      setBusy(true)
      setChangeError(null)
      try {
        const res = await firewallChange(op, rule, confirmed)
        if (res.needsConfirmation) {
          setPending({ op, rule, warnings: res.warnings ?? [] })
          return
        }
        setPending(null)
        setAddOpen(false)
        setDraft(EMPTY_RULE)
        if (res.result) setLiveResult(res.result)
      } catch (e) {
        setChangeError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const columns = useMemo<ResultColumn<FirewallRule>[]>(() => {
    const base: ResultColumn<FirewallRule>[] = [
      {
        key: 'name',
        header: 'Name',
        cell: (r) => (
          <span className={cn('text-xs', !r.enabled && 'text-muted-foreground line-through')}>{r.name}</span>
        ),
      },
      {
        key: 'dir',
        header: 'Dir',
        cell: (r) =>
          r.direction === 'inbound' ? (
            <ArrowDownToLine className="size-3.5 text-sky-500" />
          ) : (
            <ArrowUpFromLine className="size-3.5 text-violet-500" />
          ),
      },
      {
        key: 'action',
        header: 'Action',
        cell: (r) => (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[11px] font-medium',
              r.action === 'allow'
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-destructive/15 text-destructive',
            )}
          >
            {r.action}
          </span>
        ),
      },
      { key: 'proto', header: 'Protocol', cell: (r) => <span className="text-xs">{r.protocol || 'Any'}</span> },
      { key: 'lports', header: 'Local port', cell: (r) => <span className="font-mono text-xs">{r.localPorts || 'Any'}</span> },
      { key: 'raddr', header: 'Remote address', cell: (r) => <span className="font-mono text-xs">{r.remoteAddresses || 'Any'}</span> },
      { key: 'profiles', header: 'Profile', cell: (r) => <span className="text-xs">{r.profiles || '—'}</span> },
    ]
    if (!editable) return base
    return [
      ...base,
      {
        key: 'edit',
        header: '',
        cell: (r) => (
          <div className="flex items-center gap-2">
            <Switch
              checked={r.enabled}
              disabled={busy}
              onCheckedChange={(v) =>
                void applyChange('set-enabled', { ...EMPTY_RULE, name: r.name, enabled: v }, false)
              }
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={() => void applyChange('delete', { ...EMPTY_RULE, name: r.name }, false)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ),
      },
    ]
  }, [editable, busy, applyChange])

  const rows = useMemo(() => {
    let list = shown?.rules ?? []
    const f = filter.trim().toLowerCase()
    if (f)
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(f) ||
          (r.program ?? '').toLowerCase().includes(f) ||
          (r.grouping ?? '').toLowerCase().includes(f),
      )
    if (dir !== 'all') list = list.filter((r) => r.direction === dir)
    if (action !== 'all') list = list.filter((r) => r.action === action)
    return list
  }, [shown, filter, dir, action])

  const capped = rows.slice(0, 500)

  return (
    <NetworkToolScaffold
      title="Firewall Viewer"
      toolId="firewall-viewer"
      historyRefreshKey={completions}
      onRestoreRun={(stored) => restore(runToEnvelope(stored))}
      headerActions={
        editable && shown ? (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <Button type="button" size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Add rule
            </Button>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>New firewall rule</DialogTitle>
              </DialogHeader>
              <RuleForm draft={draft} onChange={setDraft} />
              {changeError ? <p className="text-xs text-destructive">{changeError}</p> : null}
              <DialogFooter>
                <DialogClose render={<Button variant="outline">Cancel</Button>} />
                <Button
                  disabled={busy || draft.name.trim().length === 0}
                  onClick={() => void applyChange('add', draft, false)}
                >
                  {busy ? 'Applying…' : 'Add rule'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : undefined
      }
      statusStrip={
        <StatusStrip
          running={running}
          items={[
            shown ? `${shown.backend}` : '',
            shown ? `${rows.length} / ${shown.rules.length} rules` : '',
            editable ? 'editing enabled' : '',
          ].filter(Boolean)}
        />
      }
      queryBar={
        <QueryBar onRun={start} running={running} runLabel="Reload">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name, program, group…"
              className="w-60"
            />
            {(['all', 'inbound', 'outbound'] as const).map((d) => (
              <Button key={d} type="button" size="xs" variant={dir === d ? 'secondary' : 'outline'} onClick={() => setDir(d)}>
                {d}
              </Button>
            ))}
            {(['all', 'allow', 'block'] as const).map((a) => (
              <Button key={a} type="button" size="xs" variant={action === a ? 'secondary' : 'outline'} onClick={() => setAction(a)}>
                {a}
              </Button>
            ))}
          </div>
        </QueryBar>
      }
      results={
        <>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : !shown ? (
            <p className="text-sm text-muted-foreground">
              Press Reload to read the OS firewall rules.{' '}
              {editable
                ? 'Toggle a rule, delete it, or add a new one — risky changes ask for confirmation and prompt for elevation.'
                : 'Read-only on this platform — rule editing is Windows-only in this release.'}
            </p>
          ) : (
            <div className="space-y-2">
              {shown.note ? <p className="text-xs text-amber-600 dark:text-amber-400">{shown.note}</p> : null}
              {changeError && !addOpen ? <p className="text-sm text-destructive">{changeError}</p> : null}
              <NetworkResultTable columns={columns} rows={capped} rowKey={(r, i) => `${r.name}-${i}`} empty="No matching rules." />
              {rows.length > capped.length ? (
                <p className="text-xs text-muted-foreground">
                  Showing {capped.length} of {rows.length} matching rules — narrow with the filter.
                </p>
              ) : null}
            </div>
          )}

          {pending ? (
            <Dialog open onOpenChange={(o) => !o && setPending(null)}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                    <TriangleAlert className="size-4" />
                    Confirm this firewall change
                  </DialogTitle>
                </DialogHeader>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {pending.warnings.map((wn, i) => (
                    <li key={i} className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                      {wn}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {pending.op === 'add' ? 'Add' : pending.op === 'delete' ? 'Delete' : 'Toggle'} rule{' '}
                  <span className="font-mono">{pending.rule.name}</span>. The backend will prompt for elevation.
                </p>
                {changeError ? <p className="text-xs text-destructive">{changeError}</p> : null}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPending(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void applyChange(pending.op, pending.rule, true)}
                  >
                    {busy ? 'Applying…' : 'Apply anyway'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
        </>
      }
    />
  )
}

function RuleForm({ draft, onChange }: { draft: FirewallRuleSpec; onChange: (r: FirewallRuleSpec) => void }) {
  const set = (patch: Partial<FirewallRuleSpec>) => onChange({ ...draft, ...patch })
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fw-name">Rule name</Label>
        <Input id="fw-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Allow HTTPS" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Direction</Label>
          <Select value={draft.direction} onValueChange={(v) => set({ direction: (v as 'inbound' | 'outbound') ?? 'inbound' })}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inbound">Inbound</SelectItem>
              <SelectItem value="outbound">Outbound</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Action</Label>
          <Select value={draft.action} onValueChange={(v) => set({ action: (v as 'allow' | 'block') ?? 'allow' })}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="allow">Allow</SelectItem>
              <SelectItem value="block">Block</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Protocol</Label>
          <Select value={draft.protocol} onValueChange={(v) => set({ protocol: (v as 'tcp' | 'udp' | 'any') ?? 'tcp' })}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tcp">TCP</SelectItem>
              <SelectItem value="udp">UDP</SelectItem>
              <SelectItem value="any">Any</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fw-port">Local port</Label>
          <Input
            id="fw-port"
            className="font-mono"
            value={draft.localPort}
            disabled={draft.protocol === 'any'}
            onChange={(e) => set({ localPort: e.target.value })}
            placeholder="443 or 80,443 or 1000-2000"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fw-raddr">Remote address (optional)</Label>
        <Input
          id="fw-raddr"
          className="font-mono"
          value={draft.remoteAddr}
          onChange={(e) => set({ remoteAddr: e.target.value })}
          placeholder="10.0.0.0/8"
        />
      </div>
    </div>
  )
}
