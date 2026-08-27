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
import type { RunEnvelope } from '@/core/network/history'
import type { ConnectionsResult, ConnRow } from '@/core/network/toolResults'

const COLUMNS: ResultColumn<ConnRow>[] = [
  { key: 'proto', header: 'Proto', cell: (r) => <span className="font-mono">{r.proto}</span> },
  {
    key: 'local',
    header: 'Local',
    cell: (r) => <span className="font-mono text-xs">{`${r.localAddr}:${r.localPort}`}</span>,
  },
  {
    key: 'remote',
    header: 'Remote',
    cell: (r) => {
      const bound = r.remoteAddr && r.remoteAddr !== '0.0.0.0' && r.remoteAddr !== '::' && r.remotePort
      return <span className="font-mono text-xs">{bound ? `${r.remoteAddr}:${r.remotePort}` : '—'}</span>
    },
  },
  { key: 'state', header: 'State', cell: (r) => r.state || '—' },
  { key: 'pid', header: 'PID', align: 'right', cell: (r) => r.pid || '—' },
  { key: 'proc', header: 'Process', cell: (r) => <span className="text-xs">{r.processName || '—'}</span> },
]

export function ConnectionsScreen() {
  const [kind, setKind] = useState<'all' | 'tcp' | 'udp'>('all')
  const [filter, setFilter] = useState('')

  const run = useCallback(
    async (signal: AbortSignal): Promise<RunEnvelope> => {
      const { envelope } = await backendGet<{ envelope: RunEnvelope }>(`/connections?kind=${kind}`, signal)
      return envelope
    },
    [kind],
  )

  const { running, error, result, completions, start, stop, restore } = useNetworkRun<ConnectionsResult>({ run })

  const rows = useMemo(() => {
    const all = result?.connections ?? []
    const f = filter.trim().toLowerCase()
    if (!f) return all
    return all.filter(
      (c) =>
        c.processName?.toLowerCase().includes(f) ||
        c.state.toLowerCase().includes(f) ||
        `${c.localAddr}:${c.localPort}`.includes(f) ||
        `${c.remoteAddr}:${c.remotePort}`.includes(f),
    )
  }, [result, filter])

  return (
    <NetworkToolScaffold
      title="Connections & Listeners"
      toolId="connections"
      historyRefreshKey={completions}
      onRestoreRun={(stored) => {
        if (stored.params.kind === 'tcp' || stored.params.kind === 'udp' || stored.params.kind === 'all') {
          setKind(stored.params.kind)
        }
        restore(runToEnvelope(stored))
      }}
      statusStrip={
        <StatusStrip
          running={running}
          items={[
            result ? `${result.connections.length} sockets` : '',
            result ? `${result.listening} listening · ${result.established} established` : '',
          ].filter(Boolean)}
        />
      }
      queryBar={
        <QueryBar onRun={start} onStop={stop} running={running} runLabel="Refresh">
          <div className="flex gap-1.5">
            {(['all', 'tcp', 'udp'] as const).map((k) => (
              <Button
                key={k}
                type="button"
                variant={kind === k ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setKind(k)}
              >
                {k.toUpperCase()}
              </Button>
            ))}
          </div>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by process, port, state…"
            className="w-64"
          />
        </QueryBar>
      }
      results={
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !result ? (
          <p className="text-sm text-muted-foreground">Press Refresh to list active sockets.</p>
        ) : (
          <NetworkResultTable columns={COLUMNS} rows={rows} rowKey={(_row, i) => i} empty="No matching sockets." />
        )
      }
    />
  )
}
