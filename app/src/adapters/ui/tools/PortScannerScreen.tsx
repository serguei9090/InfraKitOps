import { useCallback, useMemo, useState } from 'react'
import {
  NetworkResultTable,
  NetworkToolScaffold,
  QueryBar,
  QueryField,
  SavedTargetsPane,
  StatusStrip,
  useNetworkStream,
  type ResultColumn,
} from '@/adapters/ui/network'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseHostRange } from '@/core/network/hostRange'
import type { PortRow, PortScanProgress } from '@/core/network/toolResults'

// Mirrors backend portscan.Profiles.
const PROFILES: Record<string, string> = {
  Common: '21,22,23,25,53,80,110,111,135,139,143,443,445,993,995,3306,3389,5432,8080',
  Web: '80,443,8000,8008,8080,8081,8443,8888',
  Databases: '1433,1521,3306,5432,6379,9042,11211,27017',
  'Remote access': '22,23,3389,5900,5985,5986',
  Mail: '25,110,143,465,587,993,995',
}

const COLUMNS: ResultColumn<PortRow>[] = [
  { key: 'host', header: 'Host', cell: (r) => <span className="font-mono text-xs">{r.host}</span> },
  { key: 'port', header: 'Port', align: 'right', cell: (r) => <span className="font-mono">{r.port}</span> },
  { key: 'proto', header: 'Proto', cell: () => <span className="font-mono text-xs">tcp</span> },
  { key: 'service', header: 'Service', cell: (r) => r.service || '—' },
]

interface PortsResult {
  v: number
  open: PortRow[]
}

export function PortScannerScreen() {
  const [hostsText, setHostsText] = useState('')
  const [portsText, setPortsText] = useState(PROFILES.Common)
  const [showClosed, setShowClosed] = useState(false)

  const [open, setOpen] = useState<PortRow[]>([])
  const [progress, setProgress] = useState<PortScanProgress | null>(null)

  const parsed = useMemo(() => parseHostRange(hostsText, { maxAddresses: 1024 }), [hostsText])
  const hostList = useMemo(() => [...parsed.addresses, ...parsed.hostnames], [parsed])

  const onEvent = useCallback((name: string, data: unknown) => {
    if (name === 'open') setOpen((cur) => [...cur, data as PortRow])
    else if (name === 'progress') setProgress(data as PortScanProgress)
  }, [])

  const { streaming, error, envelope, completions, start, stop } = useNetworkStream({
    path: '/port-scanner/stream',
    onStart: () => {
      setOpen([])
      setProgress(null)
    },
    onEvent,
  })

  function run() {
    if (hostList.length === 0) return
    start({
      hosts: hostList.join(';'),
      ports: portsText,
      showClosed: String(showClosed),
    })
  }

  // When a run is restored from history, replay its stored open list.
  function restoreFrom(result: PortsResult) {
    setOpen(result.open ?? [])
    setProgress(null)
  }

  const pct = progress && progress.total > 0 ? progress.scanned / progress.total : streaming ? 0.02 : undefined

  return (
    <NetworkToolScaffold
      title="Port Scanner"
      toolId="port-scanner"
      historyTarget={hostList.join('; ')}
      historyRefreshKey={completions}
      onRestoreRun={(stored) => {
        if (typeof stored.params.ports === 'string') setPortsText(stored.params.ports)
        if (Array.isArray(stored.params.hosts)) setHostsText((stored.params.hosts as string[]).join('; '))
        restoreFrom(stored.result as PortsResult)
      }}
      savedTargets={
        <SavedTargetsPane
          tool="port-scanner"
          currentParams={hostList.length ? { hosts: hostList, ports: portsText } : null}
          currentLabel={hostList[0]}
          onLoad={(p) => {
            if (Array.isArray(p.hosts)) setHostsText((p.hosts as string[]).join('; '))
            if (typeof p.ports === 'string') setPortsText(p.ports)
          }}
        />
      }
      statusStrip={
        <StatusStrip
          progress={pct}
          running={streaming}
          items={[
            progress ? `${progress.scanned}/${progress.total} probed` : '',
            `${open.length} open`,
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
          canRun={hostList.length > 0 && portsText.trim().length > 0}
          runLabel="Scan"
          advanced={
            <>
              <QueryField label="Ports" htmlFor="ps-ports" className="min-w-0 flex-1 basis-[24rem]">
                <Input
                  id="ps-ports"
                  value={portsText}
                  onChange={(e) => setPortsText(e.target.value)}
                  className="font-mono text-xs"
                  placeholder="22,80,443,8000-8100"
                />
              </QueryField>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(PROFILES).map(([name, ports]) => (
                  <Button key={name} type="button" variant="outline" size="sm" onClick={() => setPortsText(ports)}>
                    {name}
                  </Button>
                ))}
              </div>
              <Button
                type="button"
                variant={showClosed ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setShowClosed((v) => !v)}
              >
                Show closed {showClosed ? 'on' : 'off'}
              </Button>
            </>
          }
        >
          <QueryField label="Host(s) / CIDR / range" htmlFor="ps-hosts" className="min-w-0 flex-1 basis-[22rem]">
            <Input
              id="ps-hosts"
              value={hostsText}
              onChange={(e) => setHostsText(e.target.value)}
              placeholder="10.0.0.1  ·  10.0.0.0/28  ·  host.example.net"
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
        ) : open.length === 0 && !streaming && !envelope ? (
          <p className="text-sm text-muted-foreground">
            Enter one or more hosts (single IP, CIDR, dash range, or hostname) and a port list, then Scan.
          </p>
        ) : (
          <NetworkResultTable
            columns={COLUMNS}
            rows={open}
            rowKey={(r) => `${r.host}:${r.port}`}
            caption={
              streaming
                ? `Scanning… ${open.length} open so far`
                : `${open.length} open port${open.length === 1 ? '' : 's'} across ${hostList.length} host${hostList.length === 1 ? '' : 's'}`
            }
            empty={streaming ? 'Scanning…' : 'No open ports found.'}
          />
        )
      }
    />
  )
}
