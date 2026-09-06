import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { saveRun, listRuns } from '@/adapters/backend/historyClient'
import {
  LatencyChart,
  NetworkToolScaffold,
  QueryBar,
  QueryField,
  SavedTargetsPane,
  Sparkline,
  StatusStrip,
  type ChartSeries,
} from '@/adapters/ui/network'
import { Button } from '@/components/ui/button'
import { SaveAsMonitorButton } from '@/adapters/ui/monitor/SaveAsMonitorButton'
import { Input } from '@/components/ui/input'
import { seriesOverTime, type RunEnvelope } from '@/core/network/history'
import { usePingMonitorStore, type HostTrack } from '@/stores/pingMonitorStore'
import { cn } from '@/lib/utils'

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6']

/**
 * Ping Monitor. The run itself lives in `pingMonitorStore`, not this component,
 * so a session survives navigating to another tool and back with no gap in the
 * chart (BACKGROUND_RUNS_PLAN.md Tier 1).
 */
export function PingMonitorScreen() {
  const running = usePingMonitorStore((s) => s.running)
  const error = usePingMonitorStore((s) => s.error)
  const tracksMap = usePingMonitorStore((s) => s.tracks)
  const liveHosts = usePingMonitorStore((s) => s.hosts)
  const startStream = usePingMonitorStore((s) => s.start)
  const stopStream = usePingMonitorStore((s) => s.stop)
  const addHostStream = usePingMonitorStore((s) => s.addHost)
  const removeHostStream = usePingMonitorStore((s) => s.removeHost)
  const restore = usePingMonitorStore((s) => s.restore)

  // Form state is local; seed it from a session that may already be running.
  const [hostsText, setHostsText] = useState(() => usePingMonitorStore.getState().hosts.join('; '))
  const [intervalMs, setIntervalMs] = useState(() => usePingMonitorStore.getState().intervalMs)
  const [downThreshold, setDownThreshold] = useState(() => usePingMonitorStore.getState().downThreshold)
  const [addText, setAddText] = useState('')
  const [priorSeries, setPriorSeries] = useState<number[]>([])

  const hosts = hostsText.split(/[\s;,]+/).map((s) => s.trim()).filter(Boolean)
  const tracks = [...tracksMap.values()]
  const targetHost = (running ? liveHosts[0] : hosts[0]) ?? ''

  function run() {
    if (hosts.length === 0) return
    startStream(hosts, { intervalMs, downThreshold })
  }

  function addHost(raw: string) {
    const h = raw.trim()
    if (!h || liveHosts.includes(h)) return
    addHostStream(h)
    setHostsText([...liveHosts, h].join('; '))
    setAddText('')
  }

  function removeHost(h: string) {
    removeHostStream(h)
    setHostsText(liveHosts.filter((x) => x !== h).join('; '))
  }

  async function stopAndSave() {
    const primary = tracksMap.get(liveHosts[0])
    stopStream()
    if (primary?.stats && primary.stats.received > 0) {
      const samples = primary.points.filter((p) => p.ms != null).map((p) => p.ms as number)
      const env: RunEnvelope = {
        tool: 'ping-monitor',
        target: primary.host,
        startedAt: primary.points[0]?.t ?? Date.now(),
        finishedAt: Date.now(),
        status: primary.stats.status === 'down' ? 'partial' : 'ok',
        params: { hosts: liveHosts, intervalMs },
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
        summary: {
          host: primary.host,
          avgMs: primary.stats.avgMs,
          lossPct: primary.stats.lossPct,
          samples: samples.length,
        },
      }
      await saveRun(env)
      void loadPrior()
    }
  }

  const loadPrior = useCallback(async () => {
    if (!targetHost) return
    const runs = await listRuns('ping-monitor', targetHost, 30)
    setPriorSeries(seriesOverTime(runs, 'avgMs').map((p) => p.value))
  }, [targetHost])

  useEffect(() => {
    void loadPrior()
  }, [loadPrior])

  const chartSeries: ChartSeries[] = tracks.map((t) => ({ host: t.host, color: t.color, points: t.points }))
  const up = tracks.filter((t) => t.stats?.status === 'up').length
  const down = tracks.filter((t) => t.stats?.status === 'down').length

  return (
    <NetworkToolScaffold
      title="Ping Monitor"
      toolId="ping-monitor"
      historyTarget={targetHost}
      onRestoreRun={(stored) => {
        const restoredHosts = Array.isArray(stored.params.hosts) ? (stored.params.hosts as string[]) : [stored.target]
        setHostsText(restoredHosts.join('; '))
        const r = stored.result as { samples?: number[] }
        const samples = r.samples ?? []
        const base = stored.startedAt
        const m = new Map<string, HostTrack>()
        m.set(stored.target, {
          host: stored.target,
          color: COLORS[0],
          stats: null,
          points: samples.map((ms, i) => ({ t: base + i * 1000, ms })),
        })
        restore(m, restoredHosts)
      }}
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
          running={running}
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
          running={running}
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
          <QueryField label="Host(s)" htmlFor="pm-hosts" className="min-w-0 flex-1 basis-[22rem]">
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
                Avg latency to {targetHost} across recent runs: <Sparkline values={priorSeries} />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            {running ? (
              <div className="flex items-center gap-2">
                <Input
                  value={addText}
                  onChange={(e) => setAddText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addHost(addText)}
                  placeholder="add a host…"
                  className="h-8 max-w-[16rem] font-mono text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => addHost(addText)}
                  disabled={!addText.trim()}
                >
                  Add host
                </Button>
              </div>
            ) : null}
            <LatencyChart series={chartSeries} windowSec={120} />
            <div className="grid gap-3 sm:grid-cols-2">
              {tracks.map((t) => (
                <HostCard key={t.host} track={t} onRemove={running ? () => removeHost(t.host) : undefined} />
              ))}
            </div>
            {targetHost ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                Keep watching {targetHost} after you leave:
                <SaveAsMonitorButton kind="icmp" target={targetHost} label="Save as monitor" />
              </div>
            ) : null}
          </div>
        )
      }
    />
  )
}

function HostCard({ track, onRemove }: { track: HostTrack; onRemove?: () => void }) {
  const s = track.stats
  const recent = track.points.slice(-40).filter((p) => p.ms != null).map((p) => p.ms as number)
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm">{track.host}</span>
        <div className="flex items-center gap-1.5">
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
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              title={`Stop pinging ${track.host}`}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
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
