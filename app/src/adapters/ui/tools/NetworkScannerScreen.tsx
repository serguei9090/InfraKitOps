import { useCallback, useMemo, useState } from 'react'
import {
  InterfacePicker,
  NetworkResultTable,
  NetworkToolScaffold,
  QueryBar,
  QueryField,
  SavedTargetsPane,
  StatusStrip,
  useNetworkStream,
  type ResultColumn,
} from '@/adapters/ui/network'
import { Input } from '@/components/ui/input'
import { parseHostRange } from '@/core/network/hostRange'
import type { NetScanProgress, ScanHostRow } from '@/core/network/toolResults'

const COLUMNS: ResultColumn<ScanHostRow>[] = [
  { key: 'ip', header: 'IP', cell: (h) => <span className="font-mono text-xs">{h.ip}</span> },
  { key: 'host', header: 'Hostname', cell: (h) => <span className="text-xs">{h.hostname || '—'}</span> },
  {
    key: 'rtt',
    header: 'RTT',
    align: 'right',
    cell: (h) => (h.rttMs != null ? <span className="font-mono tabular-nums">{h.rttMs.toFixed(1)} ms</span> : '—'),
  },
  {
    key: 'ports',
    header: 'Open ports',
    cell: (h) => (h.openPorts?.length ? <span className="font-mono text-xs">{h.openPorts.join(', ')}</span> : '—'),
  },
]

export function NetworkScannerScreen() {
  const [hostsText, setHostsText] = useState('')
  const [portsText, setPortsText] = useState('22,80,443,3389,445')
  const [sourceIp, setSourceIp] = useState('')

  const [rows, setRows] = useState<ScanHostRow[]>([])
  const [progress, setProgress] = useState<NetScanProgress | null>(null)

  const parsed = useMemo(() => parseHostRange(hostsText, { maxAddresses: 4096 }), [hostsText])
  const hostList = useMemo(() => [...parsed.addresses, ...parsed.hostnames], [parsed])

  const onEvent = useCallback((name: string, data: unknown) => {
    if (name === 'host') {
      const h = data as ScanHostRow
      setRows((cur) => {
        const next = cur.filter((r) => r.ip !== h.ip)
        next.push(h)
        return next
      })
    } else if (name === 'progress') {
      setProgress(data as NetScanProgress)
    }
  }, [])

  const { streaming, error, envelope, completions, start, stop } = useNetworkStream({
    path: '/network-scanner/stream',
    onStart: () => {
      setRows([])
      setProgress(null)
    },
    onEvent,
  })

  function run() {
    if (hostList.length === 0) return
    start({
      hosts: hostList.join(','),
      ports: portsText.trim(),
      sourceIp,
      resolve: 'true',
    })
  }

  const sortedRows = useMemo(() => [...rows].sort((a, b) => ipKey(a.ip) - ipKey(b.ip)), [rows])
  const pct = progress && progress.total > 0 ? progress.scanned / progress.total : streaming ? 0.02 : undefined

  return (
    <NetworkToolScaffold
      title="IP / Network Scanner"
      toolId="network-scanner"
      historyTarget={hostsText.trim()}
      historyRefreshKey={completions}
      onRestoreRun={(stored) => {
        if (typeof stored.params.hosts === 'string') setHostsText(stored.params.hosts)
        if (typeof stored.params.ports === 'string') setPortsText(stored.params.ports)
        const r = stored.result as { hosts?: ScanHostRow[] }
        setRows(r.hosts ?? [])
      }}
      savedTargets={
        <SavedTargetsPane
          tool="network-scanner"
          currentParams={hostsText.trim() ? { hosts: hostsText.trim(), ports: portsText } : null}
          currentLabel={hostsText.trim()}
          onLoad={(p) => {
            if (typeof p.hosts === 'string') setHostsText(p.hosts)
            if (typeof p.ports === 'string') setPortsText(p.ports)
          }}
        />
      }
      statusStrip={
        <StatusStrip
          progress={pct}
          running={streaming}
          items={[
            progress ? `${progress.scanned}/${progress.total} scanned` : '',
            `${sortedRows.filter((r) => r.alive).length} alive`,
            envelope?.finishedAt && envelope.startedAt && !streaming
              ? `${((envelope.finishedAt - envelope.startedAt) / 1000).toFixed(1)}s`
              : '',
          ].filter(Boolean)}
        />
      }
      queryBar={
        <QueryBar
          onRun={run}
          onStop={stop}
          running={streaming}
          canRun={hostList.length > 0}
          runLabel="Scan"
          advanced={
            <>
              <QueryField label="Port probe (optional)" htmlFor="ns-ports">
                <Input
                  id="ns-ports"
                  value={portsText}
                  onChange={(e) => setPortsText(e.target.value)}
                  className="w-56 font-mono text-xs"
                  placeholder="22,80,443"
                />
              </QueryField>
              <QueryField label="Source interface">
                <InterfacePicker value={sourceIp} onChange={setSourceIp} />
              </QueryField>
            </>
          }
        >
          <QueryField label="Range / CIDR / hosts" htmlFor="ns-hosts" className="min-w-0 flex-1 basis-[24rem]">
            <Input
              id="ns-hosts"
              value={hostsText}
              onChange={(e) => setHostsText(e.target.value)}
              placeholder="10.0.0.0/24  ·  10.0.0.1-50  ·  192.168.[1,2].1"
              className="font-mono"
            />
          </QueryField>
        </QueryBar>
      }
      results={
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : parsed.errors.length > 0 && hostList.length === 0 ? (
          <p className="text-sm text-destructive">{parsed.errors[0].message}</p>
        ) : sortedRows.length === 0 && !streaming ? (
          <p className="text-sm text-muted-foreground">
            Enter a CIDR, range, or host list and press Scan. ICMP + reverse DNS + optional TCP probe. ARP-based
            discovery (needs elevation) is a later addition.
          </p>
        ) : (
          <NetworkResultTable
            columns={COLUMNS}
            rows={sortedRows}
            rowKey={(h) => h.ip}
            caption={
              streaming
                ? `Scanning ${hostList.length} hosts… ${sortedRows.length} responded`
                : `${sortedRows.filter((r) => r.alive).length} live host${sortedRows.filter((r) => r.alive).length === 1 ? '' : 's'} of ${hostList.length} scanned`
            }
            empty={streaming ? 'Scanning…' : 'No live hosts found.'}
          />
        )
      }
    />
  )
}

function ipKey(ip: string): number {
  const p = ip.split('.').map(Number)
  return p.length === 4 ? ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0 : Number.MAX_SAFE_INTEGER
}
