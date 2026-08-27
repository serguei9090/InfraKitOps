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
import { Input } from '@/components/ui/input'
import type { RunEnvelope } from '@/core/network/history'
import type { NeighborEntry, NeighborResult } from '@/core/network/toolResults'

const COLUMNS: ResultColumn<NeighborEntry>[] = [
  { key: 'ip', header: 'IP address', cell: (e) => <span className="font-mono text-xs">{e.ip}</span> },
  { key: 'mac', header: 'MAC address', cell: (e) => <span className="font-mono text-xs">{e.mac}</span> },
  { key: 'iface', header: 'Interface', cell: (e) => <span className="text-xs">{e.interface || '—'}</span> },
  { key: 'state', header: 'State', cell: (e) => e.state || '—' },
  { key: 'family', header: 'Family', cell: (e) => e.family },
]

export function NeighborTableScreen() {
  const [filter, setFilter] = useState('')

  const run = useCallback(async (signal: AbortSignal): Promise<RunEnvelope> => {
    const { envelope } = await backendGet<{ envelope: RunEnvelope }>('/neighbor-table', signal)
    return envelope
  }, [])

  const { running, error, result, completions, start, restore } = useNetworkRun<NeighborResult>({ run })

  const rows = useMemo(() => {
    const all = result?.entries ?? []
    const f = filter.trim().toLowerCase()
    if (!f) return all
    return all.filter((e) => e.ip.includes(f) || e.mac.includes(f) || (e.interface ?? '').toLowerCase().includes(f))
  }, [result, filter])

  return (
    <NetworkToolScaffold
      title="Neighbor Table"
      toolId="neighbor-table"
      historyRefreshKey={completions}
      onRestoreRun={(stored) => restore(runToEnvelope(stored))}
      statusStrip={<StatusStrip running={running} items={[result ? `${result.entries.length} entries` : '']} />}
      queryBar={
        <QueryBar onRun={start} running={running} runLabel="Refresh">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by IP, MAC or interface…"
            className="w-72"
          />
        </QueryBar>
      }
      results={
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !result ? (
          <p className="text-sm text-muted-foreground">
            Press Refresh to read the OS ARP / NDP cache. Read-only — static-entry management (elevated) is a later
            addition.
          </p>
        ) : (
          <NetworkResultTable columns={COLUMNS} rows={rows} rowKey={(e) => `${e.ip}-${e.mac}`} empty="No matching entries." />
        )
      }
    />
  )
}
