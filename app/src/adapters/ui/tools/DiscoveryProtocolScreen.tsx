import { useCallback, useMemo, useState } from 'react'
import { Network, ShieldAlert } from 'lucide-react'
import {
  NetworkToolScaffold,
  QueryBar,
  QueryField,
  StatusStrip,
  useNetworkStream,
} from '@/adapters/ui/network'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useBackendStore } from '@/stores/backendStore'
import type { DiscoveryNeighbor } from '@/core/network/toolResults'

export function DiscoveryProtocolScreen() {
  const capability = useBackendStore((s) => s.capabilities?.capabilities['discovery-protocol'])

  const [windowSec, setWindowSec] = useState(65)
  const [neighbors, setNeighbors] = useState<DiscoveryNeighbor[]>([])
  const [left, setLeft] = useState<number | null>(null)
  const [note, setNote] = useState('')

  const onEvent = useCallback((name: string, data: unknown) => {
    if (name === 'neighbor') {
      const n = data as DiscoveryNeighbor
      setNeighbors((cur) => {
        const key = `${n.iface}|${n.protocol}|${n.chassisId ?? ''}|${n.portId ?? ''}`
        if (cur.some((c) => `${c.iface}|${c.protocol}|${c.chassisId ?? ''}|${c.portId ?? ''}` === key)) return cur
        return [...cur, n]
      })
    } else if (name === 'tick') {
      setLeft(Number(data) || 0)
    } else if (name === 'note') {
      setNote(String(data))
    }
  }, [])

  const { streaming, error, envelope, start, stop } = useNetworkStream({
    path: '/discovery/stream',
    onStart: () => {
      setNeighbors([])
      setLeft(windowSec)
      setNote('')
    },
    onEvent,
  })

  function run() {
    start({ windowMs: String(windowSec * 1000) })
  }

  const byIface = useMemo(() => {
    const m = new Map<string, DiscoveryNeighbor[]>()
    for (const n of neighbors) {
      const k = n.iface || '(unknown interface)'
      m.set(k, [...(m.get(k) ?? []), n])
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [neighbors])

  const unavailable = capability && !capability.available

  return (
    <NetworkToolScaffold
      title="Discovery Protocol"
      toolId="discovery-protocol"
      statusStrip={
        <StatusStrip
          running={streaming}
          items={[
            streaming && left != null ? `listening · ${left}s left` : '',
            neighbors.length ? `${neighbors.length} neighbor${neighbors.length === 1 ? '' : 's'}` : '',
            envelope?.summary?.method ? `via ${String(envelope.summary.method)}` : '',
          ].filter(Boolean)}
        />
      }
      queryBar={
        <QueryBar
          onRun={run}
          onStop={stop}
          running={streaming}
          canRun={!unavailable}
          runLabel="Start capture"
          advanced={
            <QueryField label="Window (seconds)" htmlFor="dp-win">
              <Input
                id="dp-win"
                type="number"
                min={20}
                max={300}
                value={windowSec}
                onChange={(e) => setWindowSec(Math.max(20, Math.min(300, Number(e.target.value) || 65)))}
                className="w-24"
              />
            </QueryField>
          }
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Network className="size-4" />
            Passively listens on every interface for LLDP + CDP frames.
          </div>
        </QueryBar>
      }
      results={
        unavailable ? (
          <div className="mx-auto max-w-lg rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium text-amber-600 dark:text-amber-400">
              <ShieldAlert className="size-4" /> Capture unavailable
            </div>
            <p className="text-muted-foreground">{capability?.reason}</p>
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : neighbors.length === 0 && !streaming ? (
          <p className="text-sm text-muted-foreground">
            Press Start capture. LLDP is sent every 30&nbsp;s and CDP every 60&nbsp;s, so a ~65&nbsp;s window
            catches at least one of each on an active link.
          </p>
        ) : neighbors.length === 0 && streaming ? (
          <p className="text-sm text-muted-foreground">{note || 'Listening…'}</p>
        ) : (
          <div className="space-y-5">
            {byIface.map(([iface, list]) => (
              <div key={iface}>
                <h3 className="mb-2 font-mono text-xs font-semibold text-muted-foreground">{iface}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {list.map((n, i) => (
                    <NeighborCard key={i} n={n} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      }
    />
  )
}

function NeighborCard({ n }: { n: DiscoveryNeighbor }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{n.systemName || n.chassisId || 'unknown device'}</div>
          {n.platform ? <div className="truncate text-xs text-muted-foreground">{n.platform}</div> : null}
        </div>
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
            n.protocol === 'cdp' ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400' : 'bg-primary/15 text-primary',
          )}
        >
          {n.protocol}
        </span>
      </div>

      <dl className="mt-2 space-y-1 text-xs">
        {n.portId ? (
          <Row label="Remote port">
            <span className="font-mono">{n.portId}</span>
            {n.portDesc && n.portDesc !== n.portId ? <span className="text-muted-foreground"> · {n.portDesc}</span> : null}
          </Row>
        ) : null}
        {n.nativeVlan ? <Row label="Native VLAN">{n.nativeVlan}</Row> : null}
        {n.mgmtAddrs?.length ? (
          <Row label="Mgmt">
            <span className="font-mono">{n.mgmtAddrs.join(', ')}</span>
          </Row>
        ) : null}
        {n.chassisId && n.chassisId !== n.systemName ? (
          <Row label="Chassis">
            <span className="font-mono">{n.chassisId}</span>
          </Row>
        ) : null}
        {n.softwareVersion ? <Row label="Version">{n.softwareVersion}</Row> : null}
        {n.ttl ? <Row label="TTL">{n.ttl}s</Row> : null}
      </dl>

      {n.capabilities?.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {n.capabilities.map((c) => (
            <span key={c} className="rounded bg-accent/60 px-1.5 py-0.5 text-[10px]">
              {c}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  )
}
