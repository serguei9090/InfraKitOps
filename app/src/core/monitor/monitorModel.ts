/**
 * Monitors module (MONITORS_MODULE_PLAN.md, background-runs Tier 2). Framework-
 * free model shared by the client and the status board.
 */

export type MonitorKind = 'icmp' | 'tcp' | 'http' | 'dns' | 'tls-cert' | 'domain' | 'ssh'

/** ssh-probe presets — a label that fills `command` + `assert`. */
export const SSH_PRESETS: { label: string; command: string; assert: string }[] = [
  { label: 'Disk space % used (/)', command: "df --output=pcent / | tr -dc '0-9'", assert: 'num:<90' },
  { label: 'Service active (systemd)', command: 'systemctl is-active SERVICE', assert: 'exit0' },
  { label: 'Process running', command: 'pgrep -x NAME', assert: 'exit0' },
  { label: 'Load average (1 min)', command: "cut -d' ' -f1 /proc/loadavg", assert: 'num:<4' },
  { label: 'Free memory (MB)', command: "free -m | awk 'NR==2{print $7}'", assert: 'num:>200' },
]
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
  /** comma-separated group tags (M3) */
  tags?: string
  /** per-monitor alert channel override; '' = use the default (M3) */
  channel?: string
  alertAfterSec?: number
  renotifyEverySec?: number
  /** unix ms; while now < this the monitor probes but doesn't alert (M3) */
  mutedUntil?: number
  status: MonitorStatus
  lastCheckedAt: number
  lastChangeAt: number
  createdAt: number
}

export type AlertChannel = '' | 'none' | 'webhook' | 'email' | 'desktop'

export interface MonitorSettings {
  defaultChannel: AlertChannel
  webhook: { url: string; format: 'slack' | 'discord' | 'generic'; secret: string }
  smtp: {
    host: string
    port: number
    security: 'none' | 'starttls' | 'tls'
    username: string
    password: string
    from: string
    to: string
  }
  alertAfterSec: number
  renotifyEverySec: number
  notifyOnRecovery: boolean
  runAllOnStart: boolean
}

export function defaultMonitorSettings(): MonitorSettings {
  return {
    defaultChannel: '',
    webhook: { url: '', format: 'slack', secret: '' },
    smtp: { host: '', port: 587, security: 'starttls', username: '', password: '', from: '', to: '' },
    alertAfterSec: 0,
    renotifyEverySec: 0,
    notifyOnRecovery: true,
    runAllOnStart: true,
  }
}

/** A live status-change event from GET /monitors/stream. */
export interface MonitorAlert {
  id: string
  name: string
  kind: string
  target: string
  event: 'down' | 'recovered'
  detail?: string
  at: number
}

export function tagList(tags: string | undefined): string[] {
  return (tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

export function isMuted(m: Monitor): boolean {
  return (m.mutedUntil ?? 0) > Date.now()
}

export interface MonitorSample {
  t: number
  ok: boolean
  value: number
  detail?: string
}

// --- M5: reporting -------------------------------------------------

/** A maximal down span for a monitor (GET /monitors/{id}/incidents). */
export interface MonitorIncident {
  id: number
  monitorId: string
  startedAt: number
  endedAt: number // 0 = ongoing
  detail?: string
  suppressed?: boolean
}

/** ok-ratio (0..1) over trailing windows. */
export interface UptimeWindows {
  '24h': number
  '7d': number
  '30d': number
}

export interface MonitorSummary {
  monitors: Record<string, UptimeWindows>
  tags: Record<string, UptimeWindows>
}

export interface MonitorReport {
  monitor: Monitor
  uptime: UptimeWindows
  mttrMs: number
  mtbfMs: number
  incidents: MonitorIncident[]
  generatedAt: number
}

export type SeriesPeriod = 'raw' | '1m' | '1h'

/** One downsampled chart point (GET /monitors/{id}/series). */
export interface SeriesPoint {
  t: number
  ok: number // raw: 0|1 · rollup: ok-ratio 0..1
  value: number // avg ms of the ok samples
  min: number
  max: number
  total: number
}

/** A configured public status page (owner-scoped CRUD). */
export interface StatusBoard {
  id: string
  token: string
  title: string
  tags: string // comma list; '' = every monitor
  showIncidents: boolean
  createdAt: number
}

export interface PublicComponent {
  name: string
  status: MonitorStatus
  uptime: UptimeWindows
}

export interface PublicStatusIncident {
  name: string
  startedAt: number
  endedAt: number
}

/** The payload of the unauthenticated GET /status/{token}. */
export interface PublicStatusPage {
  title: string
  generatedAt: number
  ok: boolean
  components: PublicComponent[]
  incidents: PublicStatusIncident[]
}

export const UPTIME_RANGES = ['24h', '7d', '30d'] as const
export type UptimeRange = (typeof UPTIME_RANGES)[number]

export function rangeSinceMs(r: UptimeRange, now = Date.now()): number {
  const d = r === '24h' ? 1 : r === '7d' ? 7 : 30
  return now - d * 86_400_000
}

/** Format an ok-ratio as a percentage; more decimals near 100%. */
export function fmtUptime(r: number | undefined | null): string {
  if (r == null) return '—'
  const pct = r * 100
  return `${pct >= 99.95 ? pct.toFixed(2) : pct.toFixed(1)}%`
}

export function fmtDuration(ms: number): string {
  if (ms <= 0) return '0s'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`
  const d = Math.floor(h / 24)
  return `${d}d${h % 24 ? ` ${h % 24}h` : ''}`
}

/** color for an uptime pill — green ≥ 99.9%, amber ≥ 99%, red below. */
export function uptimeTone(r: number | undefined | null): string {
  if (r == null) return 'text-muted-foreground'
  if (r >= 0.999) return 'text-emerald-500'
  if (r >= 0.99) return 'text-amber-500'
  return 'text-destructive'
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
  {
    kind: 'ssh',
    label: 'SSH command check',
    targetLabel: 'Host (or use a node)',
    targetPlaceholder: 'db.internal — leave blank if picking a node',
    unit: '',
    higherIsWorse: true,
    defaultIntervalSec: 300,
    // ssh fields (node picker + preset + command + assert) are rendered
    // bespoke in the dialog, not through configFields.
    configFields: [],
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
  } else if (kind === 'ssh') {
    if (s('command')) parts.push(`\`${s('command')}\``)
    if (s('assert') && s('assert') !== 'exit0') parts.push(s('assert'))
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
