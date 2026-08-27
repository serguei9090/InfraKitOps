import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { backendGet } from '@/adapters/backend/backendClient'
import {
  NetworkResultTable,
  NetworkToolScaffold,
  QueryBar,
  StatusStrip,
  useNetworkRun,
  type ResultColumn,
} from '@/adapters/ui/network'
import { runToEnvelope } from '@/core/network/history'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { RunEnvelope } from '@/core/network/history'
import type { FirewallResult, FirewallRule } from '@/core/network/toolResults'

const COLUMNS: ResultColumn<FirewallRule>[] = [
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
  { key: 'rports', header: 'Remote port', cell: (r) => <span className="font-mono text-xs">{r.remotePorts || 'Any'}</span> },
  {
    key: 'raddr',
    header: 'Remote address',
    cell: (r) => <span className="font-mono text-xs">{r.remoteAddresses || 'Any'}</span>,
  },
  { key: 'profiles', header: 'Profile', cell: (r) => <span className="text-xs">{r.profiles || '—'}</span> },
]

export function FirewallViewerScreen() {
  const [filter, setFilter] = useState('')
  const [dir, setDir] = useState<'all' | 'inbound' | 'outbound'>('all')
  const [action, setAction] = useState<'all' | 'allow' | 'block'>('all')

  const run = useCallback(async (signal: AbortSignal): Promise<RunEnvelope> => {
    const { envelope } = await backendGet<{ envelope: RunEnvelope }>('/firewall-viewer', signal)
    return envelope
  }, [])

  const { running, error, result, completions, start, restore } = useNetworkRun<FirewallResult>({ run })

  const rows = useMemo(() => {
    let list = result?.rules ?? []
    const f = filter.trim().toLowerCase()
    if (f) list = list.filter((r) => r.name.toLowerCase().includes(f) || (r.program ?? '').toLowerCase().includes(f) || (r.grouping ?? '').toLowerCase().includes(f))
    if (dir !== 'all') list = list.filter((r) => r.direction === dir)
    if (action !== 'all') list = list.filter((r) => r.action === action)
    return list
  }, [result, filter, dir, action])

  const capped = rows.slice(0, 500)

  return (
    <NetworkToolScaffold
      title="Firewall Viewer"
      toolId="firewall-viewer"
      historyRefreshKey={completions}
      onRestoreRun={(stored) => restore(runToEnvelope(stored))}
      statusStrip={
        <StatusStrip
          running={running}
          items={[
            result ? `${result.backend}` : '',
            result ? `${rows.length} / ${result.rules.length} rules` : '',
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
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !result ? (
          <p className="text-sm text-muted-foreground">
            Press Reload to read the OS firewall rules. <strong>Read-only</strong> — rule editing is a separate future
            release.
          </p>
        ) : (
          <div className="space-y-2">
            {result.note ? <p className="text-xs text-amber-600 dark:text-amber-400">{result.note}</p> : null}
            <NetworkResultTable columns={COLUMNS} rows={capped} rowKey={(r, i) => `${r.name}-${i}`} empty="No matching rules." />
            {rows.length > capped.length ? (
              <p className="text-xs text-muted-foreground">
                Showing {capped.length} of {rows.length} matching rules — narrow with the filter.
              </p>
            ) : null}
          </div>
        )
      }
    />
  )
}
