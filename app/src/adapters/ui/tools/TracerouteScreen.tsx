import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
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
import type { GeoPoint } from '@/adapters/ui/network/GeoMap'
import type { TraceHop } from '@/core/network/toolResults'

// The world outline (~55 KB) + map code load only when a geolocated trace runs.
const GeoMap = lazy(() => import('@/adapters/ui/network/GeoMap'))

export function TracerouteScreen() {
  const [host, setHost] = useState('')
  const [maxHops, setMaxHops] = useState(30)
  const [geo, setGeo] = useState(false)

  const [hops, setHops] = useState<TraceHop[]>([])
  const [reached, setReached] = useState<boolean | null>(null)

  const geoPoints = useMemo<GeoPoint[]>(() => {
    const withCoords = hops.filter((h) => h.lat != null && h.lon != null && (h.lat !== 0 || h.lon !== 0))
    return withCoords.map((h, i) => ({
      id: h.ttl,
      lat: h.lat as number,
      lon: h.lon as number,
      label: `Hop ${h.ttl} · ${[h.city, h.country].filter(Boolean).join(', ') || 'unknown'}`,
      lines: [h.hostname || h.addr || '', h.isp || '', h.rttsMs.length ? `${Math.min(...h.rttsMs).toFixed(1)} ms` : ''].filter(Boolean),
      connect: i > 0,
    }))
  }, [hops])

  const onEvent = useCallback((name: string, data: unknown) => {
    if (name === 'hop') {
      const raw = data as TraceHop
      const hop: TraceHop = { ...raw, rttsMs: raw.rttsMs ?? [] }
      setHops((cur) => {
        const next = cur.filter((h) => h.ttl !== hop.ttl)
        next.push(hop)
        next.sort((a, b) => a.ttl - b.ttl)
        return next
      })
      if (hop.reached) setReached(true)
    }
  }, [])

  const { streaming, error, envelope, completions, start, stop } = useNetworkStream({
    path: '/traceroute/stream',
    onStart: () => {
      setHops([])
      setReached(null)
    },
    onEvent,
  })

  function run() {
    if (!host.trim()) return
    start({
      host: host.trim(),
      maxHops: String(maxHops),
      geo: String(geo),
      resolve: 'true',
    })
  }

  const columns: ResultColumn<TraceHop>[] = [
    { key: 'ttl', header: '#', align: 'right', cell: (h) => h.ttl },
    {
      key: 'rtt',
      header: 'RTT',
      cell: (h) =>
        h.rttsMs.length === 0 ? (
          <span className="text-muted-foreground">* * *</span>
        ) : (
          <span className="font-mono tabular-nums">{h.rttsMs.map((r) => `${r.toFixed(1)}`).join('  ')} ms</span>
        ),
    },
    {
      key: 'addr',
      header: 'Address',
      cell: (h) => (h.addr ? <span className="font-mono text-xs">{h.addr}</span> : <span className="text-muted-foreground">—</span>),
    },
    { key: 'host', header: 'Hostname', cell: (h) => <span className="text-xs">{h.hostname || '—'}</span> },
    ...(geo
      ? ([
          {
            key: 'geo',
            header: 'Location',
            cell: (h: TraceHop) =>
              h.country ? (
                <span className="text-xs">
                  {[h.city, h.country].filter(Boolean).join(', ')}
                  {h.isp ? <span className="text-muted-foreground"> · {h.isp}</span> : null}
                </span>
              ) : (
                '—'
              ),
          },
        ] as ResultColumn<TraceHop>[])
      : []),
  ]

  return (
    <NetworkToolScaffold
      title="Traceroute"
      toolId="traceroute"
      historyTarget={host.trim()}
      historyRefreshKey={completions}
      onRestoreRun={(stored) => {
        if (typeof stored.params.host === 'string') setHost(stored.params.host)
        const r = stored.result as { hops?: TraceHop[]; reached?: boolean }
        setHops((r.hops ?? []).map((h) => ({ ...h, rttsMs: h.rttsMs ?? [] })))
        setReached(r.reached ?? null)
      }}
      savedTargets={
        <SavedTargetsPane
          tool="traceroute"
          currentParams={host.trim() ? { host: host.trim(), maxHops } : null}
          currentLabel={host.trim()}
          onLoad={(p) => {
            if (typeof p.host === 'string') setHost(p.host)
            if (typeof p.maxHops === 'number') setMaxHops(p.maxHops)
          }}
        />
      }
      statusStrip={
        <StatusStrip
          running={streaming}
          items={[
            hops.length ? `${hops.length} hop${hops.length === 1 ? '' : 's'}` : '',
            reached === true ? 'destination reached' : reached === false ? 'not reached' : '',
            envelope && !streaming && envelope.finishedAt && envelope.startedAt
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
          canRun={host.trim().length > 0}
          runLabel="Trace"
          advanced={
            <>
              <QueryField label="Max hops" htmlFor="tr-max">
                <Input
                  id="tr-max"
                  type="number"
                  min={1}
                  max={64}
                  value={maxHops}
                  onChange={(e) => setMaxHops(Math.max(1, Math.min(64, Number(e.target.value) || 30)))}
                  className="w-24"
                />
              </QueryField>
              <Button type="button" variant={geo ? 'secondary' : 'outline'} size="sm" onClick={() => setGeo((v) => !v)}>
                Per-hop geolocation {geo ? 'on' : 'off'}
              </Button>
            </>
          }
        >
          <QueryField label="Destination" htmlFor="tr-host" className="min-w-[22rem] flex-1">
            <Input
              id="tr-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && host.trim() && run()}
              placeholder="example.com  or  1.1.1.1"
              className="font-mono"
            />
          </QueryField>
        </QueryBar>
      }
      results={
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : hops.length === 0 && !streaming ? (
          <p className="text-sm text-muted-foreground">Enter a destination and press Trace.</p>
        ) : (
          <div className="space-y-4">
            {geo && geoPoints.length > 0 ? (
              <Suspense fallback={<p className="text-sm text-muted-foreground">Loading map…</p>}>
                <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
                  <GeoMap points={geoPoints} height={320} className="p-2" />
                </div>
              </Suspense>
            ) : null}
            <NetworkResultTable
              columns={columns}
              rows={hops}
              rowKey={(h) => h.ttl}
              caption={streaming ? `Tracing… ${hops.length} hops` : undefined}
              empty={streaming ? 'Tracing…' : 'No hops.'}
            />
          </div>
        )
      }
    />
  )
}
