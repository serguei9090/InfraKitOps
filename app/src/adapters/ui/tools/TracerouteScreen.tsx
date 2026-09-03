import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import {
  NetworkResultTable,
  NetworkToolScaffold,
  QueryBar,
  QueryField,
  SavedTargetsPane,
  Sparkline,
  StatusStrip,
  useNetworkStream,
  type ResultColumn,
} from '@/adapters/ui/network'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { GeoPoint } from '@/adapters/ui/network/GeoMap'
import type { TraceHop, TraceHopStat } from '@/core/network/toolResults'

// The world outline (~55 KB) + map code load only when a geolocated trace runs.
const GeoMap = lazy(() => import('@/adapters/ui/network/GeoMap'))

type Mode = 'once' | 'live'

const num = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—')

function lossClass(pct: number): string {
  if (pct <= 0) return 'text-emerald-600 dark:text-emerald-400'
  if (pct < 50) return 'text-amber-600 dark:text-amber-400'
  return 'text-destructive'
}

/** Legacy `Hop[]` (from a restored `done` envelope) → the mtr row shape. */
function hopToStat(h: TraceHop): TraceHopStat {
  const recv = h.rttsMs.length
  const sent = recv + (h.timeouts ?? 0)
  const best = recv ? Math.min(...h.rttsMs) : 0
  const worst = recv ? Math.max(...h.rttsMs) : 0
  const avg = recv ? h.rttsMs.reduce((a, b) => a + b, 0) / recv : 0
  return {
    ttl: h.ttl,
    addr: h.addr ?? '',
    addrs: h.addr ? [h.addr] : [],
    hostname: h.hostname,
    sent,
    recv,
    lossPct: sent ? ((sent - recv) / sent) * 100 : 0,
    lastMs: recv ? h.rttsMs[recv - 1] : 0,
    bestMs: best,
    worstMs: worst,
    avgMs: avg,
    stdevMs: 0,
    jitterMs: 0,
    recent: h.rttsMs,
    reached: h.reached,
    country: h.country,
    city: h.city,
    isp: h.isp,
    lat: h.lat,
    lon: h.lon,
  }
}

function toCSV(rows: TraceHopStat[]): string {
  const head = ['ttl', 'addr', 'hostname', 'lossPct', 'sent', 'recv', 'lastMs', 'avgMs', 'bestMs', 'worstMs', 'stdevMs', 'jitterMs']
  const body = rows.map((r) =>
    [r.ttl, r.addr, r.hostname ?? '', r.lossPct.toFixed(1), r.sent, r.recv, r.lastMs.toFixed(2), r.avgMs.toFixed(2), r.bestMs.toFixed(2), r.worstMs.toFixed(2), r.stdevMs.toFixed(2), r.jitterMs.toFixed(2)].join(','),
  )
  return [head.join(','), ...body].join('\n')
}

export function TracerouteScreen() {
  const [host, setHost] = useState('')
  const [maxHops, setMaxHops] = useState(30)
  const [geo, setGeo] = useState(false)
  const [mode, setMode] = useState<Mode>('once')
  const [intervalMs, setIntervalMs] = useState(1000)

  const [stats, setStats] = useState<TraceHopStat[]>([])
  const [rounds, setRounds] = useState(0)
  const [reached, setReached] = useState<boolean | null>(null)

  const geoPoints = useMemo<GeoPoint[]>(() => {
    const withCoords = stats.filter((h) => h.lat != null && h.lon != null && (h.lat !== 0 || h.lon !== 0))
    return withCoords.map((h, i) => ({
      id: h.ttl,
      lat: h.lat as number,
      lon: h.lon as number,
      label: `Hop ${h.ttl} · ${[h.city, h.country].filter(Boolean).join(', ') || 'unknown'}`,
      lines: [h.hostname || h.addr || '', h.isp || '', h.recv ? `${h.bestMs.toFixed(1)} ms` : ''].filter(Boolean),
      connect: i > 0,
    }))
  }, [stats])

  const onEvent = useCallback((name: string, data: unknown) => {
    if (name === 'hop-update') {
      const st = data as TraceHopStat
      setStats((cur) => {
        const next = cur.filter((h) => h.ttl !== st.ttl)
        next.push({ ...st, addrs: st.addrs ?? [], recent: st.recent ?? [] })
        next.sort((a, b) => a.ttl - b.ttl)
        return next
      })
      if (st.reached) setReached(true)
    } else if (name === 'round') {
      setRounds(Number(data) || 0)
    }
  }, [])

  const { streaming, error, envelope, completions, start, stop } = useNetworkStream({
    path: '/traceroute/stream',
    onStart: () => {
      setStats([])
      setRounds(0)
      setReached(null)
    },
    onEvent,
  })

  const liveRounds = rounds || (stats.some((s) => s.sent > 0) ? 1 : 0)

  function run() {
    if (!host.trim()) return
    const params: Record<string, string> = {
      host: host.trim(),
      maxHops: String(maxHops),
      geo: String(geo),
      resolve: 'true',
    }
    if (mode === 'live') {
      params.continuous = 'true'
      params.intervalMs = String(intervalMs)
    } else {
      params.rounds = '1'
    }
    start(params)
  }

  function exportCSV() {
    const blob = new Blob([toCSV(stats)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `traceroute-${host.trim() || 'run'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const columns: ResultColumn<TraceHopStat>[] = [
    { key: 'ttl', header: '#', align: 'right', cell: (h) => h.ttl },
    {
      key: 'host',
      header: 'Host',
      cell: (h) =>
        h.addr ? (
          <div className="leading-tight">
            {h.hostname ? <div className="text-xs">{h.hostname}</div> : null}
            <div className="font-mono text-xs text-muted-foreground">
              {h.addr}
              {h.addrs.length > 1 ? <span className="ml-1 text-[10px] text-amber-600">+{h.addrs.length - 1} ECMP</span> : null}
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground">* * *</span>
        ),
    },
    { key: 'loss', header: 'Loss', align: 'right', cell: (h) => <span className={cn('font-mono tabular-nums', lossClass(h.lossPct))}>{h.lossPct.toFixed(0)}%</span> },
    { key: 'snt', header: 'Snt', align: 'right', cell: (h) => <span className="font-mono tabular-nums text-muted-foreground">{h.sent}</span> },
    { key: 'last', header: 'Last', align: 'right', cell: (h) => <span className="font-mono tabular-nums">{h.recv ? num(h.lastMs) : '—'}</span> },
    { key: 'avg', header: 'Avg', align: 'right', cell: (h) => <span className="font-mono tabular-nums">{h.recv ? num(h.avgMs) : '—'}</span> },
    { key: 'best', header: 'Best', align: 'right', cell: (h) => <span className="font-mono tabular-nums text-muted-foreground">{h.recv ? num(h.bestMs) : '—'}</span> },
    { key: 'wrst', header: 'Wrst', align: 'right', cell: (h) => <span className="font-mono tabular-nums text-muted-foreground">{h.recv ? num(h.worstMs) : '—'}</span> },
    { key: 'stdev', header: 'StDev', align: 'right', cell: (h) => <span className="font-mono tabular-nums text-muted-foreground">{h.recv > 1 ? num(h.stdevMs) : '—'}</span> },
    {
      key: 'spark',
      header: '',
      cell: (h) => (h.recent.length > 1 ? <Sparkline values={h.recent} width={90} height={22} /> : <span className="text-muted-foreground">·</span>),
    },
    ...(geo
      ? ([
          {
            key: 'geo',
            header: 'Location',
            cell: (h: TraceHopStat) =>
              h.country ? (
                <span className="text-xs">
                  {[h.city, h.country].filter(Boolean).join(', ')}
                  {h.isp ? <span className="text-muted-foreground"> · {h.isp}</span> : null}
                </span>
              ) : (
                '—'
              ),
          },
        ] as ResultColumn<TraceHopStat>[])
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
        const r = stored.result as { hops?: TraceHop[]; reached?: boolean; rounds?: number }
        setStats((r.hops ?? []).map((h) => hopToStat({ ...h, rttsMs: h.rttsMs ?? [] })))
        setRounds(r.rounds ?? 0)
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
            stats.length ? `${stats.length} hop${stats.length === 1 ? '' : 's'}` : '',
            liveRounds ? `${liveRounds} round${liveRounds === 1 ? '' : 's'}` : '',
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
          runLabel={mode === 'live' ? 'Start' : 'Trace'}
          advanced={
            <>
              <QueryField label="Mode" htmlFor="tr-mode">
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant={mode === 'once' ? 'secondary' : 'outline'} onClick={() => setMode('once')}>
                    One-shot
                  </Button>
                  <Button type="button" size="sm" variant={mode === 'live' ? 'secondary' : 'outline'} onClick={() => setMode('live')}>
                    Live
                  </Button>
                </div>
              </QueryField>
              {mode === 'live' ? (
                <QueryField label="Interval (ms)" htmlFor="tr-int">
                  <Input
                    id="tr-int"
                    type="number"
                    min={200}
                    max={10000}
                    step={100}
                    value={intervalMs}
                    onChange={(e) => setIntervalMs(Math.max(200, Math.min(10000, Number(e.target.value) || 1000)))}
                    className="w-24"
                  />
                </QueryField>
              ) : null}
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
              {stats.length > 0 ? (
                <Button type="button" variant="outline" size="sm" onClick={exportCSV}>
                  Export CSV
                </Button>
              ) : null}
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
        ) : stats.length === 0 && !streaming ? (
          <p className="text-sm text-muted-foreground">Enter a destination and press {mode === 'live' ? 'Start' : 'Trace'}.</p>
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
              rows={stats}
              rowKey={(h) => h.ttl}
              caption={streaming ? (mode === 'live' ? `Tracing live · round ${liveRounds}` : `Tracing… ${stats.length} hops`) : undefined}
              empty={streaming ? 'Tracing…' : 'No hops.'}
            />
          </div>
        )
      }
    />
  )
}
