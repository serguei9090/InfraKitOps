/**
 * Monitors module (MONITORS_MODULE_PLAN.md, background-runs Tier 2). Framework-
 * free model shared by the client and the status board.
 */

export type MonitorKind = 'icmp' | 'tcp' | 'http' | 'dns' | 'tls-cert' | 'domain'
export type MonitorStatus = 'up' | 'down' | 'unknown' | 'paused'

/** A config_json field the New/Edit dialog renders for a given kind. */
export type ConfigField =
  | { key: string; label: string; type: 'text'; placeholder?: string; hint?: string }
  | { key: string; label: string; type: 'number'; default?: number; hint?: string }
  | { key: string; label: string; type: 'bool'; default?: boolean; hint?: string }
  | { key: string; label: string; type: 'select'; options: string[]; default?: string }

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
  /** default check interval in seconds (matches the backend's kindDefaultInterval) */
  defaultIntervalSec: number
  /** kind-specific config_json fields shown in the New/Edit dialog */
  configFields: ConfigField[]
}

export const KINDS: KindMeta[] = [
  {
    kind: 'icmp',
    label: 'Ping (ICMP)',
    targetLabel: 'Host',
    targetPlaceholder: '1.1.1.1 or gateway.local',
    unit: 'ms',
    higherIsWorse: true,
    defaultIntervalSec: 60,
    configFields: [],
  },
  {
    kind: 'tcp',
    label: 'TCP port',
    targetLabel: 'Host:port',
    targetPlaceholder: 'db.internal:5432',
    unit: 'ms',
    higherIsWorse: true,
    defaultIntervalSec: 60,
    configFields: [],
  },
  {
    kind: 'http',
    label: 'HTTP(S)',
    targetLabel: 'URL',
    targetPlaceholder: 'https://example.com/health',
    unit: 'ms',
    higherIsWorse: true,
    defaultIntervalSec: 60,
    configFields: [
      { key: 'method', label: 'Method', type: 'select', options: ['GET', 'HEAD', 'POST'], default: 'GET' },
      { key: 'expectStatus', label: 'Expected status', type: 'text', placeholder: '200-399 (default)' },
      { key: 'maxLatencyMs', label: 'Max latency (ms)', type: 'number', hint: '0 = no limit' },
      { key: 'followRedirects', label: 'Follow redirects', type: 'bool', default: true },
      { key: 'assertBodyContains', label: 'Body must contain', type: 'text', placeholder: 'optional' },
      { key: 'assertJsonPath', label: 'JSON path', type: 'text', placeholder: 'data.status' },
      { key: 'assertJsonEquals', label: 'JSON path equals', type: 'text', placeholder: 'ok' },
    ],
  },
  {
    kind: 'dns',
    label: 'DNS resolves',
    targetLabel: 'Name',
    targetPlaceholder: 'example.com',
    unit: 'ms',
    higherIsWorse: true,
    defaultIntervalSec: 60,
    configFields: [
      {
        key: 'recordType',
        label: 'Record type',
        type: 'select',
        options: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'],
        default: 'A',
      },
      { key: 'expected', label: 'Expected value(s)', type: 'text', placeholder: 'comma-separated, optional' },
      { key: 'resolver', label: 'Resolver', type: 'text', placeholder: '1.1.1.1 (default)' },
    ],
  },
  {
    kind: 'tls-cert',
    label: 'TLS cert expiry',
    targetLabel: 'Host',
    targetPlaceholder: 'example.com:443',
    unit: 'days',
    higherIsWorse: false,
    defaultIntervalSec: 3600,
    configFields: [{ key: 'warnDays', label: 'Warn when days left ≤', type: 'number', default: 21 }],
  },
  {
    kind: 'domain',
    label: 'Domain expiry (whois)',
    targetLabel: 'Domain',
    targetPlaceholder: 'example.com',
    unit: 'days',
    higherIsWorse: false,
    defaultIntervalSec: 43200,
    configFields: [{ key: 'warnDays', label: 'Warn when days left ≤', type: 'number', default: 30 }],
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

/** One-line human summary of a monitor's kind-specific config, for the detail view. */
export function configSummary(kind: MonitorKind, config: Record<string, unknown> | undefined): string {
  const c = config ?? {}
  const parts: string[] = []
  const s = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : '')
  const n = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : undefined)
  if (kind === 'http') {
    if (s('method') && s('method') !== 'GET') parts.push(s('method'))
    if (s('expectStatus')) parts.push(`status ${s('expectStatus')}`)
    if (n('maxLatencyMs')) parts.push(`≤ ${n('maxLatencyMs')} ms`)
    if (s('assertBodyContains')) parts.push(`body ~ "${s('assertBodyContains')}"`)
    if (s('assertJsonPath')) parts.push(`${s('assertJsonPath')}${s('assertJsonEquals') ? ` = ${s('assertJsonEquals')}` : ''}`)
    if (c.followRedirects === false) parts.push('no redirects')
  } else if (kind === 'dns') {
    parts.push(s('recordType') || 'A')
    if (s('expected')) parts.push(`= ${s('expected')}`)
    if (s('resolver')) parts.push(`via ${s('resolver')}`)
  } else if (kind === 'tls-cert' || kind === 'domain') {
    parts.push(`warn ≤ ${n('warnDays') ?? (kind === 'domain' ? 30 : 21)} days`)
  }
  return parts.join(' · ')
}

export function relTime(ms: number): string {
  if (!ms) return 'never'
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
