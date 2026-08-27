import { useCallback, useEffect, useMemo, useState } from 'react'
import { saveRun } from '@/adapters/backend/historyClient'
import { listRuns } from '@/adapters/backend/historyClient'
import {
  LatencyChart,
  NetworkToolScaffold,
  QueryBar,
  QueryField,
  SavedTargetsPane,
  Sparkline,
  StatusStrip,
  useNetworkStream,
  type ChartSeries,
} from '@/adapters/ui/network'
import { Input } from '@/components/ui/input'
import { seriesOverTime, type RunEnvelope } from '@/core/network/history'
import type { PingSample, PingStats } from '@/core/network/toolResults'
import { cn } from '@/lib/utils'

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6']

interface HostTrack {
  host: string
  color: string
  stats: PingStats | null
  points: { t: number; ms: number | null }[]
}

export function PingMonitorScreen() {
  const [hostsText, setHostsText] = useState('')
  const [intervalMs, setIntervalMs] = useState(1000)
  const [downThreshold, setDownThreshold] = useState(3)

  const hosts = useMemo(
    () => hostsText.split(/[\s;,]+/).map((s) => s.trim()).filter(Boolean),
    [hostsText],
  )

  const [tracksMap, setTracksMap] = useState<Map<string, HostTrack>>(new Map())
  const [priorSeries, setPriorSeries] = useState<number[]>([])

  const onStart = useCallback(() => {
    const m = new Map<string, HostTrack>()
    hosts.forEach((h, i) => m.set(h, { host: h, color: COLORS[i % COLORS.length], stats: null, points: [] }))
    setTracksMap(m)
  }, [hosts])

  const onEvent = useCallback((name: string, data: unknown) => {
    setTracksMap((prev) => {
      const next = new Map(prev)
      if (name === 'sample') {
        const s = data as PingSample
        const tr = next.get(s.host)
        if (tr) {
          const points = [...tr.points, { t: Date.now(), ms: s.ok ? s.rttMs : null }]
          next.set(s.host, { ...tr, points: points.length > 5000 ? points.slice(-5000) : points })
        }
      } else if (name === 'stats' || name === 'status') {
        const st = data as PingStats
        const tr = next.get(st.host)
        if (tr) next.set(st.host, { ...tr, stats: st })
      }
      return next
    })
  }, [])

  const { streaming, error, start, stop } = useNetworkStream({
    path: '/ping-monitor/stream',
    onStart,
    onEvent,
    save: false,
  })

  function run() {
    if (hosts.length === 0) return
    start({ hosts: hosts.join(';'), intervalMs: String(intervalMs), downThreshold: String(downThreshold) })
  }

  async function stopAndSave() {
    stop()
    const primary = tracksMap.get(hosts[0])
    if (primary?.stats && primary.stats.received > 0) {
      const samples = primary.points.filter((p) => p.ms != null).map((p) => p.ms as number)
      const env: RunEnvelope = {
        tool: 'ping-monitor',
        target: primary.host,
        startedAt: primary.points[0]?.t ?? Date.now(),
        finishedAt: Date.now(),
        status: primary.stats.status === 'down' ? 'partial' : 'ok',
        params: { hosts, intervalMs },
        resultShape: 'scalar_series',
        result: {
          v: 1,
          unit: 'ms',
          samples,
          stats: {
            min: primary.stats.minMs,
            avg: primary.stats.avgMs,
            p50: median(samples),
            p95: primary.stats.p95Ms,
            max: primary.stats.maxMs,
            loss: primary.stats.lossPct / 100,
          },
        },
        summary: { host: primary.host, avgMs: primary.stats.avgMs, lossPct: primary.stats.lossPct, samples: samples.length },
      }
      await saveRun(env)
      void loadPrior()
    }
  }

  const loadPrior = useCallback(async () => {
    if (!hosts[0]) return
    const runs = await listRuns('ping-monitor', hosts[0], 30)
    setPriorSeries(seriesOverTime(runs, 'avgMs').map((p) => p.value))
  }, [hosts])

  useEffect(() => {
    void loadPrior()
  }, [loadPrior])

  const tracks = [...tracksMap.values()]
  const chartSeries: ChartSeries[] = tracks.map((t) => ({ host: t.host, color: t.color, points: t.points }))
  const up = tracks.filter((t) => t.stats?.status === 'up').length
  const down = tracks.filter((t) => t.stats?.status === 'down').length

  return (
    <NetworkToolScaffold
      title="Ping Monitor"
      toolId="ping-monitor"
      historyTarget={hosts[0]}
      savedTargets={
        <SavedTargetsPane
          tool="ping-monitor"
          currentParams={hosts.length ? { hosts, intervalMs } : null}
          currentLabel={hosts[0]}
          onLoad={(p) => {
            if (Array.isArray(p.hosts)) setHostsText((p.hosts as string[]).join('; '))
            if (typeof p.intervalMs === 'number') setIntervalMs(p.intervalMs)
          }}
        />
      }
      statusStrip={
        <StatusStrip
          running={streaming}
          items={[
            tracks.length ? `${up} up · ${down} down` : '',
            tracks[0]?.stats ? `${tracks[0].host}: ${tracks[0].stats.lastRttMs} ms, ${tracks[0].stats.lossPct}% loss` : '',
          ].filter(Boolean)}
        />
      }
      queryBar={
        <QueryBar
          onRun={run}
          onStop={stopAndSave}
          running={streaming}
          canRun={hosts.length > 0}
          runLabel="Start"
          advanced={
            <>
              <QueryField label="Interval (ms)" htmlFor="pm-interval">
                <Input
                  id="pm-interval"
                  type="number"
                  min={200}
                  value={intervalMs}
                  onChange={(e) => setIntervalMs(Math.max(200, Number(e.target.value) || 1000))}
                  className="w-28"
                />
              </QueryField>
              <QueryField label="Down after N fails" htmlFor="pm-down">
                <Input
                  id="pm-down"
                  type="number"
                  min={1}
                  value={downThreshold}
                  onChange={(e) => setDownThreshold(Math.max(1, Number(e.target.value) || 3))}
                  className="w-24"
                />
              </QueryField>
            </>
          }
        >
          <QueryField label="Host(s)" htmlFor="pm-hosts" className="min-w-[22rem] flex-1">
            <Input
              id="pm-hosts"
              value={hostsText}
              onChange={(e) => setHostsText(e.target.value)}
              placeholder="1.1.1.1; gateway.local; example.com"
              className="font-mono"
            />
          </QueryField>
        </QueryBar>
      }
      results={
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : tracks.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Enter one or more hosts and press Start.</p>
            {priorSeries.length >= 2 ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                Avg latency to {hosts[0]} across recent runs: <Sparkline values={priorSeries} />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <LatencyChart series={chartSeries} windowSec={120} />
            <div className="grid gap-3 sm:grid-cols-2">
              {tracks.map((t) => (
                <HostCard key={t.host} track={t} />
              ))}
            </div>
          </div>
        )
      }
    />
  )
}

function HostCard({ track }: { track: HostTrack }) {
  const s = track.stats
  const recent = track.points.slice(-40).filter((p) => p.ms != null).map((p) => p.ms as number)
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm">{track.host}</span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            s?.status === 'up' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
            s?.status === 'down' && 'bg-destructive/15 text-destructive',
            (!s || s.status === 'pending') && 'bg-muted text-muted-foreground',
          )}
        >
          {s?.status ?? 'pending'}
        </span>
      </div>
      {s ? (
        <>
          <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
            <Metric label="last" value={`${s.lastRttMs}`} />
            <Metric label="avg" value={`${s.avgMs}`} />
            <Metric label="p95" value={`${s.p95Ms}`} />
            <Metric label="loss" value={`${s.lossPct}%`} />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {s.received}/{s.sent} · jitter {s.jitterMs} ms
            </span>
            {recent.length >= 2 ? <Sparkline values={recent} width={90} height={20} /> : null}
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">waiting for first reply…</p>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono tabular-nums">{value}</p>
      <p className="text-muted-foreground">{label}</p>
    </div>
  )
}

function median(v: number[]): number {
  if (v.length === 0) return 0
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
