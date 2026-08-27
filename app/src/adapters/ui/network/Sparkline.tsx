interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  className?: string
}

/**
 * Tiny inline-SVG trend line — used in history rows and result views to show a
 * metric (usually latency) across past runs. Emphasised endpoint, faint area.
 */
export function Sparkline({ values, width = 120, height = 28, className }: SparklineProps) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = width / (values.length - 1)
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4)
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`)
  const line = pts.join(' ')
  const area = `0,${height} ${line} ${width},${height}`
  const last = values[values.length - 1]

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} role="img" aria-label="trend">
      <polygon points={area} className="fill-primary/10" />
      <polyline points={line} fill="none" className="stroke-primary" strokeWidth={1.25} strokeLinejoin="round" />
      <circle cx={width} cy={y(last)} r={2} className="fill-primary" />
    </svg>
  )
}
