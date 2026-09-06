/**
 * Monitors module (MONITORS_MODULE_PLAN.md, background-runs Tier 2). Framework-
 * free model shared by the client and the status board.
 */

export type MonitorKind = 'icmp' | 'tcp' | 'http' | 'dns' | 'tls-cert'
export type MonitorStatus = 'up' | 'down' | 'unknown' | 'paused'

export interface Monitor {
  id: string
  owner?: string
  name: string
  kind: MonitorKind
  target: string
  intervalSec: number
  timeoutSec: number
  failThreshold: number
  enabled: boolean
  config?: Record<string, unknown>
  status: MonitorStatus
  lastCheckedAt: number
  lastChangeAt: number
  createdAt: number
}

export interface MonitorSample {
  t: number
  ok: boolean
  value: number
  detail?: string
}

export interface KindMeta {
  kind: MonitorKind
  label: string
  targetLabel: string
  targetPlaceholder: string
  /** unit for the `value` axis */
  unit: string
  /** true when a bigger value is worse (latency), false for cert days-left */
  higherIsWorse: boolean
}

export const KINDS: KindMeta[] = [
  {
    kind: 'icmp',
    label: 'Ping (ICMP)',
    targetLabel: 'Host',
    targetPlaceholder: '1.1.1.1 or gateway.local',
    unit: 'ms',
    higherIsWorse: true,
  },
  {
    kind: 'tcp',
    label: 'TCP port',
    targetLabel: 'Host:port',
    targetPlaceholder: 'db.internal:5432',
    unit: 'ms',
    higherIsWorse: true,
  },
  {
    kind: 'http',
    label: 'HTTP(S)',
    targetLabel: 'URL',
    targetPlaceholder: 'https://example.com/health',
    unit: 'ms',
    higherIsWorse: true,
  },
  {
    kind: 'dns',
    label: 'DNS resolves',
    targetLabel: 'Name',
    targetPlaceholder: 'example.com',
    unit: '',
    higherIsWorse: false,
  },
  {
    kind: 'tls-cert',
    label: 'TLS cert expiry',
    targetLabel: 'Host',
    targetPlaceholder: 'example.com:443',
    unit: 'days',
    higherIsWorse: false,
  },
]

export const kindMeta = (k: MonitorKind): KindMeta => KINDS.find((m) => m.kind === k) ?? KINDS[0]

export const STATUS_COLOR: Record<MonitorStatus, string> = {
  up: 'text-emerald-500',
  down: 'text-destructive',
  unknown: 'text-muted-foreground',
  paused: 'text-muted-foreground',
}

export const STATUS_DOT: Record<MonitorStatus, string> = {
  up: 'bg-emerald-500',
  down: 'bg-destructive',
  unknown: 'bg-muted-foreground/50',
  paused: 'bg-muted-foreground/30',
}

/** Uptime % over a sample window. */
export function uptimePct(samples: MonitorSample[]): number | null {
  if (samples.length === 0) return null
  const ok = samples.filter((s) => s.ok).length
  return Math.round((ok / samples.length) * 1000) / 10
}

export function relTime(ms: number): string {
  if (!ms) return 'never'
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
