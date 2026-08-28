import { useMemo, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { WORLD_LAND } from './worldLand'

/**
 * Self-contained world map — a bundled, hard-simplified Natural Earth land
 * outline (≈55 KB) drawn as SVG with an equirectangular projection. No tile
 * server, no map library, works offline and inside the Tauri CSP. Used by
 * Traceroute to show where each hop is; reusable by IP Geolocation and the
 * network scanner later.
 */

export interface GeoPoint {
  /** Stable id for React keys and hover state. */
  id: string | number
  lat: number
  lon: number
  label: string
  lines?: string[]
  /** Draw a dashed connector from the previous point to this one. */
  connect?: boolean
}

const LAND = WORLD_LAND

// viewBox is 360×180 so one unit == one degree; project maps straight in.
const W = 360
const H = 180
const project = (lon: number, lat: number): [number, number] => [lon + 180, 90 - lat]

const landPath = LAND.map((poly) =>
  poly
    .map((ring) => {
      let d = ''
      for (let i = 0; i < ring.length; i += 2) {
        const [x, y] = project(ring[i], ring[i + 1])
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1)
      }
      return d + 'Z'
    })
    .join(''),
).join('')

export function GeoMap({
  points,
  height = 300,
  className,
}: {
  points: GeoPoint[]
  height?: number
  className?: string
}) {
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 })
  const [hover, setHover] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const located = useMemo(
    () => points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && (p.lat !== 0 || p.lon !== 0)),
    [points],
  )

  // Screen position of a lon/lat given the current pan/zoom, in viewBox units.
  const place = (lon: number, lat: number): [number, number] => {
    const [px, py] = project(lon, lat)
    return [px * view.k + view.tx, py * view.k + view.ty]
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = ((e.clientX - rect.left) / rect.width) * W
    const my = ((e.clientY - rect.top) / rect.height) * H
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2
    setView((v) => {
      const k = Math.max(1, Math.min(12, v.k * factor))
      const scale = k / v.k
      return { k, tx: mx - (mx - v.tx) * scale, ty: my - (my - v.ty) * scale }
    })
  }

  function onPointerDown(e: React.PointerEvent) {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
    setDragging(true)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const dx = ((e.clientX - drag.current.x) / rect.width) * W
    const dy = ((e.clientY - drag.current.y) / rect.height) * H
    setView((v) => ({ ...v, tx: drag.current!.tx + dx, ty: drag.current!.ty + dy }))
  }
  function onPointerUp() {
    drag.current = null
    setDragging(false)
  }

  const connectorD = located
    .map((p, i) => {
      const [x, y] = place(p.lon, p.lat)
      const cmd = i === 0 || !p.connect ? 'M' : 'L'
      return `${cmd}${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')

  const hoverPoint = hover != null ? located.find((p) => p.id === hover) : undefined
  const hoverXY = hoverPoint ? place(hoverPoint.lon, hoverPoint.lat) : null

  return (
    <div className={className} style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height, display: 'block', touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <rect x={0} y={0} width={W} height={H} className="fill-muted/40" />
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
          <path d={landPath} className="fill-muted-foreground/25 stroke-muted-foreground/20" strokeWidth={0.2} />
        </g>

        {connectorD ? (
          <path
            d={connectorD}
            className="stroke-primary/70"
            fill="none"
            strokeWidth={1}
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {located.map((p) => {
          const [x, y] = place(p.lon, p.lat)
          const active = hover === p.id
          return (
            <circle
              key={p.id}
              cx={x}
              cy={y}
              r={active ? 3 : 2}
              className={active ? 'fill-primary stroke-background' : 'fill-primary/80 stroke-background'}
              strokeWidth={0.6}
              onPointerEnter={() => setHover(p.id as number)}
              onPointerLeave={() => setHover(null)}
              style={{ cursor: 'pointer' }}
            />
          )
        })}
      </svg>

      <button
        type="button"
        onClick={() => setView({ k: 1, tx: 0, ty: 0 })}
        className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-border/60 bg-background/80 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur hover:text-foreground"
      >
        <RotateCcw className="size-3" />
        Reset
      </button>

      {hoverPoint && hoverXY ? (
        <div
          className="pointer-events-none absolute z-10 max-w-[16rem] rounded-lg border border-border/60 bg-popover p-2.5 text-xs shadow-md"
          style={{
            left: `${Math.max(2, Math.min(70, (hoverXY[0] / W) * 100))}%`,
            top: `${Math.max(10, Math.min(92, (hoverXY[1] / H) * 100))}%`,
            transform: 'translateY(-105%)',
          }}
        >
          <p className="font-medium">{hoverPoint.label}</p>
          {hoverPoint.lines?.map((l, i) => (
            <p key={i} className="text-muted-foreground">
              {l}
            </p>
          ))}
        </div>
      ) : null}

      <p className="mt-1 text-[11px] text-muted-foreground">Scroll to zoom · drag to pan</p>
    </div>
  )
}

export default GeoMap
