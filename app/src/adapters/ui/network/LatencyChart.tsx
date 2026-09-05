import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

export interface ChartSeries {
  host: string
  color: string
  /** {t: unix ms, ms: rtt} — assumed roughly time-ordered. A null ms marks a loss. */
  points: { t: number; ms: number | null }[]
}

interface LatencyChartProps {
  series: ChartSeries[]
  /** Rolling window in seconds; older points are clipped. */
  windowSec?: number
  height?: number
}

/**
 * Lightweight multi-series latency chart — inline SVG, no dependency, offline.
 * A faint grid, an area under each line, an emphasised last point. Losses show
 * as gaps. A legend row lets each host's line be hidden/shown independently —
 * useful once more than a couple of hosts are being monitored at once.
 * See NETWORK_MODULE_PLAN.md §3 ("give sparklines the same care as type").
 */
export function LatencyChart({ series, windowSec = 120, height = 160 }: LatencyChartProps) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const visible = series.filter((s) => !hidden.has(s.host))

  function toggle(host: string) {
    setHidden((cur) => {
      const next = new Set(cur)
      if (next.has(host)) next.delete(host)
      else next.add(host)
      return next
    })
  }

  const now = Date.now()
  const tMin = now - windowSec * 1000

  const model = useMemo(() => {
    let maxMs = 10
    for (const s of visible) {
      for (const p of s.points) {
        if (p.t >= tMin && p.ms != null && p.ms > maxMs) maxMs = p.ms
      }
    }
    maxMs = niceCeil(maxMs)
    return { maxMs }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, hidden, tMin])

  const W = 600
  const H = height
  const padL = 34
  const padB = 4
  const padT = 6
  const plotW = W - padL
  const plotH = H - padB - padT

  const x = (t: number) => padL + ((t - tMin) / (windowSec * 1000)) * plotW
  const y = (ms: number) => padT + plotH - (ms / model.maxMs) * plotH

  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => ({
    yy: padT + plotH - f * plotH,
    label: Math.round(model.maxMs * f),
  }))

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
      {series.length > 1 ? (
        <div className="flex flex-wrap gap-1.5 border-b border-border/60 px-2.5 py-2">
          {series.map((s) => {
            const isHidden = hidden.has(s.host)
            return (
              <button
                key={s.host}
                type="button"
                onClick={() => toggle(s.host)}
                title={isHidden ? `Show ${s.host}` : `Hide ${s.host}`}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors',
                  isHidden
                    ? 'border-border/60 text-muted-foreground/60 line-through'
                    : 'border-border/60 text-foreground hover:bg-muted',
                )}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color, opacity: isHidden ? 0.3 : 1 }}
                />
                {s.host}
              </button>
            )
          })}
        </div>
      ) : null}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Latency over time">
        {gridLines.map((g) => (
          <g key={g.yy}>
            <line x1={padL} x2={W} y1={g.yy} y2={g.yy} stroke="currentColor" strokeOpacity={0.08} />
            <text x={padL - 6} y={g.yy + 3} textAnchor="end" className="fill-muted-foreground" fontSize={9}>
              {g.label}
            </text>
          </g>
        ))}
        {visible.map((s) => {
          const pts = s.points.filter((p) => p.t >= tMin)
          const segments = splitOnGaps(pts)
          const lastOk = [...pts].reverse().find((p) => p.ms != null)
          return (
            <g key={s.host}>
              {segments.map((seg, i) => {
                const line = seg.map((p) => `${x(p.t).toFixed(1)},${y(p.ms as number).toFixed(1)}`).join(' ')
                const area = `${x(seg[0].t).toFixed(1)},${(padT + plotH).toFixed(1)} ${line} ${x(seg[seg.length - 1].t).toFixed(1)},${(padT + plotH).toFixed(1)}`
                return (
                  <g key={i}>
                    <polygon points={area} fill={s.color} fillOpacity={0.1} />
                    <polyline points={line} fill="none" stroke={s.color} strokeWidth={1.5} strokeLinejoin="round" />
                  </g>
                )
              })}
              {lastOk ? <circle cx={x(lastOk.t)} cy={y(lastOk.ms as number)} r={2.5} fill={s.color} /> : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function splitOnGaps(pts: { t: number; ms: number | null }[]): { t: number; ms: number | null }[][] {
  const out: { t: number; ms: number | null }[][] = []
  let cur: { t: number; ms: number | null }[] = []
  for (const p of pts) {
    if (p.ms == null) {
      if (cur.length) out.push(cur)
      cur = []
    } else {
      cur.push(p)
    }
  }
  if (cur.length) out.push(cur)
  return out.filter((s) => s.length >= 1)
}

function niceCeil(v: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * pow
}
