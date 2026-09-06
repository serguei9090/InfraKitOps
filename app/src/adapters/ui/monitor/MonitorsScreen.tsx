import { useEffect, useMemo, useState } from 'react'
import { BellOff, ChevronLeft, Download, FileUp, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useBackendStore } from '@/stores/backendStore'
import { useMonitorStore } from '@/stores/monitorStore'
import {
  configSummary,
  fmtDuration,
  fmtUptime,
  isMuted,
  KINDS,
  kindMeta,
  MONITOR_TEMPLATES,
  relTime,
  SSH_PRESETS,
  STATUS_DOT,
  tagList,
  UPTIME_RANGES,
  uptimeTone,
  type ConfigField,
  type Monitor,
  type MonitorKind,
  type MonitorIncident,
  type MonitorSample,
  type SeriesPoint,
  type UptimeRange,
  type UptimeWindows,
} from '@/core/monitor/monitorModel'
import { listNodes } from '@/adapters/backend/runbookClient'
import { monitorReport } from '@/adapters/backend/monitorClient'
import { LatencyChart } from '@/adapters/ui/network'
import { BackendUnavailable } from '@/adapters/ui/network/BackendUnavailable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const NO_SAMPLES: MonitorSample[] = []
const NO_POINTS: SeriesPoint[] = []
const NO_INCIDENTS: MonitorIncident[] = []

/**
 * Monitors status board (MONITORS_MODULE_PLAN.md M1). Left: every monitor with
 * its live status; right: the selected monitor's history + controls. Checks run
 * server-side — this page just watches them.
 */
export function MonitorsScreen() {
  const status = useBackendStore((s) => s.status)
  const refreshBackend = useBackendStore((s) => s.refresh)
  const reconnecting = useBackendStore((s) => s.reconnecting)

  const allMonitors = useMonitorStore((s) => s.monitors)
  const loaded = useMonitorStore((s) => s.loaded)
  const selectedId = useMonitorStore((s) => s.selectedId)
  const startPolling = useMonitorStore((s) => s.startPolling)
  const stopPolling = useMonitorStore((s) => s.stopPolling)
  const select = useMonitorStore((s) => s.select)
  const tagFilter = useMonitorStore((s) => s.tagFilter)
  const setTagFilter = useMonitorStore((s) => s.setTagFilter)
  const checkAll = useMonitorStore((s) => s.checkAll)
  const summary = useMonitorStore((s) => s.summary)

  const [editing, setEditing] = useState<Partial<Monitor> | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [sweeping, setSweeping] = useState(false)
  const consumeNew = useMonitorStore((s) => s.consumeNew)
  const pendingNew = useMonitorStore((s) => s.pendingNew)

  const tags = [...new Set(allMonitors.flatMap((m) => tagList(m.tags)))].sort()
  const monitors = tagFilter ? allMonitors.filter((m) => tagList(m.tags).includes(tagFilter)) : allMonitors

  useEffect(() => {
    if (status === 'unknown') void refreshBackend()
  }, [status, refreshBackend])

  useEffect(() => {
    if (status === 'available') startPolling()
    return () => stopPolling()
  }, [status, startPolling, stopPolling])

  // "Save as monitor" from another tool (Ping / X.509 / DNS / Whois).
  useEffect(() => {
    const spec = consumeNew()
    if (spec) setEditing(spec)
  }, [pendingNew, consumeNew])

  if (status === 'unavailable') {
    return <BackendUnavailable onRetry={refreshBackend} retrying={reconnecting} />
  }

  const selected = allMonitors.find((m) => m.id === selectedId) ?? null

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-2">
        <h1 className="text-sm font-semibold">Monitors</h1>
        <span className="text-xs text-muted-foreground">
          {monitors.length} · {monitors.filter((m) => m.status === 'down').length} down
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          disabled={sweeping || allMonitors.length === 0}
          onClick={async () => {
            setSweeping(true)
            await checkAll()
            setTimeout(() => setSweeping(false), 1800)
          }}
        >
          <RefreshCw className={cn('size-4', sweeping && 'animate-spin')} /> Run all checks now
        </Button>
        <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
          <FileUp className="size-4" /> Import
        </Button>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="size-4" /> New monitor
        </Button>
      </header>

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/40 px-4 py-2">
          <button
            type="button"
            onClick={() => setTagFilter(null)}
            className={cn(
              'rounded-full border px-2 py-0.5 text-xs',
              !tagFilter ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 text-muted-foreground',
            )}
          >
            All
          </button>
          {tags.map((t) => {
            const u = summary.tags[t]?.['24h']
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTagFilter(t === tagFilter ? null : t)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-xs',
                  t === tagFilter ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 text-muted-foreground',
                )}
              >
                {t}
                {u != null && <span className={cn('ml-1 tabular-nums', uptimeTone(u))}>{fmtUptime(u)}</span>}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            'w-full shrink-0 overflow-y-auto border-border/60 md:w-[22rem] md:border-r',
            selected && 'hidden md:block',
          )}
        >
          {!loaded ? (
            <p className="p-4 text-xs text-muted-foreground">Loading…</p>
          ) : monitors.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              No monitors yet. Create one — it runs on the backend and keeps going after you close this.
            </p>
          ) : (
            monitors.map((m) => (
              <MonitorRow
                key={m.id}
                m={m}
                uptime={summary.monitors[m.id]?.['24h']}
                active={m.id === selectedId}
                onClick={() => void select(m.id === selectedId ? null : m.id)}
              />
            ))
          )}
        </div>

        <div className={cn('min-w-0 flex-1 overflow-y-auto', !selected && 'hidden md:block')}>
          {selected ? (
            <MonitorDetail
              m={selected}
              onEdit={() => setEditing(selected)}
              onBack={() => void select(null)}
            />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">Select a monitor to see its history.</p>
          )}
        </div>
      </div>

      {editing && (
        <MonitorDialog
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  )
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const bulkImport = useMonitorStore((s) => s.bulkImport)
  const fromTemplate = useMonitorStore((s) => s.fromTemplate)
  const [text, setText] = useState('')
  const [hostname, setHostname] = useState('')
  const [tmplTags, setTmplTags] = useState('')
  const [template, setTemplate] = useState<string>(MONITOR_TEMPLATES[0].id)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ created: number; errors: { line: number; text: string; error: string }[] } | null>(null)

  const runPaste = async () => {
    setBusy(true)
    const r = await bulkImport(text)
    setBusy(false)
    setResult(r)
    if (r.errors.length === 0 && r.created > 0) setTimeout(onClose, 700)
  }
  const runTemplate = async () => {
    if (!hostname.trim()) return
    setBusy(true)
    const n = await fromTemplate(template, hostname.trim(), tmplTags.trim())
    setBusy(false)
    if (n > 0) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import monitors</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="paste">
          <TabsList>
            <TabsTrigger value="paste">Paste list</TabsTrigger>
            <TabsTrigger value="template">Template</TabsTrigger>
          </TabsList>

          <TabsContent value="paste" className="space-y-2">
            <p className="text-xs text-muted-foreground">
              One monitor per line: <code>name,kind,target</code> (optional 4th field = tags). Blank lines and{' '}
              <code>#</code> comments are skipped.
            </p>
            <Textarea
              rows={7}
              className="font-mono text-xs"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'prod gw,icmp,10.0.0.1\napi,http,https://example.com/health,prod\ncert,tls-cert,example.com:443'}
            />
            {result && (
              <div className="rounded border border-border/60 p-2 text-xs">
                <p className="text-emerald-600 dark:text-emerald-500">{result.created} created</p>
                {result.errors.map((e) => (
                  <p key={e.line} className="text-destructive">
                    line {e.line}: {e.error}
                  </p>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button disabled={busy || !text.trim()} onClick={() => void runPaste()}>
                {busy ? 'Importing…' : 'Import'}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="template" className="space-y-2">
            <div className="space-y-1">
              <Label>Template</Label>
              <Select value={template} onValueChange={(v) => v && setTemplate(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONITOR_TEMPLATES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label} — {t.desc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tmpl-host">Hostname</Label>
              <Input
                id="tmpl-host"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="example.com"
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tmpl-tags">Extra tags</Label>
              <Input id="tmpl-tags" value={tmplTags} onChange={(e) => setTmplTags(e.target.value)} placeholder="prod" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={busy || !hostname.trim()} onClick={() => void runTemplate()}>
                {busy ? 'Creating…' : 'Create group'}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function MonitorRow({
  m,
  uptime,
  active,
  onClick,
}: {
  m: Monitor
  uptime?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 border-b border-border/40 px-4 py-2.5 text-left hover:bg-accent/30',
        active && 'bg-accent/40',
      )}
    >
      <span className={cn('size-2.5 shrink-0 rounded-full', STATUS_DOT[m.status])} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{m.name}</span>
          {isMuted(m) && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 text-[9px] text-muted-foreground">
              <BellOff className="size-2.5" /> muted
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {m.kind} · {m.target}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        {uptime != null && (
          <span className={cn('text-[11px] tabular-nums', uptimeTone(uptime))} title="24h uptime">
            {fmtUptime(uptime)}
          </span>
        )}
        <span className="text-[10px] uppercase text-muted-foreground">
          {m.status === 'paused' ? 'paused' : relTime(m.lastCheckedAt)}
        </span>
      </div>
    </button>
  )
}

async function exportReport(id: string, name: string, fmt: 'json' | 'csv') {
  const rep = await monitorReport(id)
  const safe = name.replace(/[^\w.-]+/g, '_') || id
  let blob: Blob
  if (fmt === 'json') {
    blob = new Blob([JSON.stringify(rep, null, 2)], { type: 'application/json' })
  } else {
    const cell = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)
    const rows = [
      ['incident_id', 'started_at', 'ended_at', 'duration_ms', 'ongoing', 'detail'],
      ...rep.incidents.map((i) => [
        String(i.id),
        new Date(i.startedAt).toISOString(),
        i.endedAt ? new Date(i.endedAt).toISOString() : '',
        String((i.endedAt || rep.generatedAt) - i.startedAt),
        i.endedAt ? 'false' : 'true',
        i.detail ?? '',
      ]),
    ]
    blob = new Blob([rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv' })
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}-report.${fmt}`
  a.click()
  URL.revokeObjectURL(url)
}

function MonitorDetail({ m, onEdit, onBack }: { m: Monitor; onEdit: () => void; onBack: () => void }) {
  const samples = useMonitorStore((s) => (s.samplesFor === m.id ? s.samples : NO_SAMPLES))
  const points = useMonitorStore((s) => (s.seriesFor === m.id ? s.seriesPoints : NO_POINTS))
  const seriesPeriod = useMonitorStore((s) => s.seriesPeriod)
  const seriesRange = useMonitorStore((s) => s.seriesRange)
  const setSeriesRange = useMonitorStore((s) => s.setSeriesRange)
  const incidents = useMonitorStore((s) => (s.incidentsFor === m.id ? s.incidents : NO_INCIDENTS))
  const win = useMonitorStore((s) => s.summary.monitors[m.id])
  const setPaused = useMonitorStore((s) => s.setPaused)
  const remove = useMonitorStore((s) => s.remove)
  const checkNow = useMonitorStore((s) => s.checkNow)
  const mute = useMonitorStore((s) => s.mute)
  const unmute = useMonitorStore((s) => s.unmute)
  const meta = kindMeta(m.kind)
  const muted = isMuted(m)

  const series = useMemo(
    () => [
      {
        host: m.name,
        color: m.status === 'down' ? '#ef4444' : '#4f46e5',
        points: points.map((p) => ({ t: p.t, ms: p.total > 0 && p.value > 0 ? p.value : null })),
      },
    ],
    [points, m.name, m.status],
  )
  const windowSec = seriesRange === '24h' ? 86_400 : seriesRange === '7d' ? 604_800 : 2_592_000
  const last = samples.at(-1)

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground md:hidden"
      >
        <ChevronLeft className="size-3.5" /> All monitors
      </button>
      <div className="flex items-start gap-3">
        <span className={cn('mt-1.5 size-3 shrink-0 rounded-full', STATUS_DOT[m.status])} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{m.name}</h2>
            <span className="text-xs uppercase text-muted-foreground">{m.status}</span>
            {muted && (
              <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                <BellOff className="size-2.5" /> muted
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {meta.label} · <span className="font-mono">{m.target}</span> · every {m.intervalSec}s · down after{' '}
            {m.failThreshold} fails
          </p>
          {configSummary(m.kind, m.config) ? (
            <p className="text-[11px] text-muted-foreground/80">{configSummary(m.kind, m.config)}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={() => void checkNow(m.id)}>
          <RefreshCw className="size-3.5" /> Check now
        </Button>
        <Button size="sm" variant="outline" onClick={() => void setPaused(m.id, m.enabled)}>
          {m.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          {m.enabled ? 'Pause' : 'Resume'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => (muted ? void unmute(m.id) : void mute(m.id, Date.now() + 3_600_000))}
        >
          <BellOff className="size-3.5" /> {muted ? 'Unmute' : 'Snooze 1h'}
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" variant="outline" onClick={() => void exportReport(m.id, m.name, 'csv')}>
          <Download className="size-3.5" /> CSV
        </Button>
        <Button size="sm" variant="outline" onClick={() => void exportReport(m.id, m.name, 'json')}>
          <Download className="size-3.5" /> JSON
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (confirm(`Delete monitor "${m.name}"?`)) void remove(m.id)
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <UptimeStats win={win} last={last} meta={meta} />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">
            Response {meta.unit || 'time'} · {seriesPeriod === 'raw' ? 'per check' : `${seriesPeriod} buckets`}
          </p>
          <div className="flex gap-1">
            {UPTIME_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setSeriesRange(r)}
                className={cn(
                  'rounded border px-1.5 py-0.5 text-[11px]',
                  r === seriesRange
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 text-muted-foreground',
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        {points.length >= 2 ? (
          <LatencyChart series={series} windowSec={windowSec} height={180} />
        ) : (
          <p className="text-xs text-muted-foreground">Not enough history in this range yet.</p>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          Incidents (30d){incidents.length ? ` · ${incidents.length}` : ''}
        </p>
        {incidents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No downtime recorded in the last 30 days.</p>
        ) : (
          <div className="max-h-56 divide-y divide-border/40 overflow-y-auto rounded border border-border/60 text-xs">
            {incidents.map((i) => (
              <div key={i.id} className="flex items-center gap-2 px-2 py-1.5">
                <span
                  className={cn('size-1.5 shrink-0 rounded-full', i.endedAt ? 'bg-muted-foreground/50' : 'bg-destructive')}
                />
                <span className="w-32 shrink-0 text-muted-foreground">{new Date(i.startedAt).toLocaleString()}</span>
                <span className="w-16 shrink-0 tabular-nums">
                  {fmtDuration((i.endedAt || Date.now()) - i.startedAt)}
                </span>
                {!i.endedAt && <span className="shrink-0 font-medium text-destructive">ongoing</span>}
                {i.suppressed && <span className="shrink-0 text-muted-foreground">suppressed</span>}
                <span className="truncate text-muted-foreground">{i.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Recent checks</p>
        <div className="max-h-64 divide-y divide-border/40 overflow-y-auto rounded border border-border/60 text-xs">
          {[...samples].reverse().slice(0, 60).map((s, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1">
              <span className={cn('size-1.5 rounded-full', s.ok ? 'bg-emerald-500' : 'bg-destructive')} />
              <span className="w-28 shrink-0 text-muted-foreground">{new Date(s.t).toLocaleTimeString()}</span>
              <span className="w-16 shrink-0 tabular-nums">
                {s.ok && meta.unit ? `${Math.round(s.value)} ${meta.unit}` : s.ok ? 'ok' : 'fail'}
              </span>
              <span className="truncate text-muted-foreground">{s.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function UptimeStats({
  win,
  last,
  meta,
}: {
  win: UptimeWindows | undefined
  last: MonitorSample | undefined
  meta: ReturnType<typeof kindMeta>
}) {
  return (
    <div className="grid grid-cols-2 gap-3 text-center lg:grid-cols-4">
      {(['24h', '7d', '30d'] as UptimeRange[]).map((r) => (
        <div key={r} className="rounded-lg border border-border/60 bg-card p-3">
          <p className={cn('font-mono text-lg tabular-nums', uptimeTone(win?.[r]))}>{fmtUptime(win?.[r])}</p>
          <p className="text-[11px] text-muted-foreground">uptime {r}</p>
        </div>
      ))}
      <div className="rounded-lg border border-border/60 bg-card p-3">
        <p className="font-mono text-lg tabular-nums">
          {last ? (meta.unit ? `${Math.round(last.value)} ${meta.unit}` : last.ok ? 'ok' : 'fail') : '—'}
        </p>
        <p className="text-[11px] text-muted-foreground">last {meta.unit || 'result'}</p>
      </div>
    </div>
  )
}

function ConfigInput({
  field,
  value,
  onChange,
}: {
  field: ConfigField
  value: unknown
  onChange: (v: unknown) => void
}) {
  const id = `cfg-${field.key}`
  if (field.type === 'bool') {
    const checked = typeof value === 'boolean' ? value : (field.default ?? false)
    return (
      <div className="col-span-2 flex items-center justify-between">
        <Label htmlFor={id}>{field.label}</Label>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
    )
  }
  if (field.type === 'select') {
    return (
      <div className="space-y-1">
        <Label>{field.label}</Label>
        <Select value={(value as string) || field.default} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{field.label}</Label>
      <Input
        id={id}
        type={field.type === 'number' ? 'number' : 'text'}
        value={value == null ? '' : String(value)}
        placeholder={'placeholder' in field ? field.placeholder : undefined}
        onChange={(e) =>
          onChange(field.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)
        }
      />
      {'hint' in field && field.hint ? <p className="text-[10px] text-muted-foreground">{field.hint}</p> : null}
    </div>
  )
}

function SshConfig({
  config,
  setCfg,
}: {
  config: Record<string, unknown>
  setCfg: (key: string, val: unknown) => void
}) {
  const [nodes, setNodes] = useState<{ id: string; name: string; host: string }[]>([])
  useEffect(() => {
    void listNodes()
      .then((ns) => setNodes(ns.map((n) => ({ id: n.id, name: n.name, host: n.host }))))
      .catch(() => setNodes([]))
  }, [])

  const nodeId = (config.nodeId as string) ?? ''

  return (
    <div className="space-y-2 rounded-md border border-border/50 p-3">
      <div className="space-y-1">
        <Label>SSH node</Label>
        <Select value={nodeId || 'inline'} onValueChange={(v) => setCfg('nodeId', !v || v === 'inline' ? '' : v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inline">Inline host (agent auth)</SelectItem>
            {nodes.map((n) => (
              <SelectItem key={n.id} value={n.id}>
                {n.name} — {n.host}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!nodeId && (
          <Input
            placeholder="user (with the Host field above)"
            value={(config.user as string) ?? ''}
            onChange={(e) => setCfg('user', e.target.value)}
          />
        )}
      </div>
      <div className="space-y-1">
        <Label>Preset</Label>
        <Select
          value=""
          onValueChange={(v) => {
            const p = SSH_PRESETS.find((x) => x.label === v)
            if (p) {
              setCfg('command', p.command)
              setCfg('assert', p.assert)
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Pick a common check…" />
          </SelectTrigger>
          <SelectContent>
            {SSH_PRESETS.map((p) => (
              <SelectItem key={p.label} value={p.label}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ssh-cmd">Command</Label>
        <Input
          id="ssh-cmd"
          className="font-mono text-xs"
          value={(config.command as string) ?? ''}
          onChange={(e) => setCfg('command', e.target.value)}
          placeholder="df --output=pcent / | tr -dc '0-9'"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ssh-assert">Assert</Label>
        <Input
          id="ssh-assert"
          className="font-mono text-xs"
          value={(config.assert as string) ?? ''}
          onChange={(e) => setCfg('assert', e.target.value)}
          placeholder="exit0  ·  contains:active  ·  matches:^ok$  ·  num:<90"
        />
      </div>
    </div>
  )
}

function MonitorDialog({ initial, onClose }: { initial: Partial<Monitor> | null; onClose: () => void }) {
  const isEdit = Boolean(initial?.id)
  const save = useMonitorStore((s) => s.save)
  const allMonitors = useMonitorStore((s) => s.monitors)
  const [name, setName] = useState(initial?.name ?? '')
  const [dependsOn, setDependsOn] = useState(initial?.dependsOn ?? '')
  const [kind, setKind] = useState<MonitorKind>(initial?.kind ?? 'icmp')
  const [target, setTarget] = useState(initial?.target ?? '')
  const [intervalSec, setIntervalSec] = useState(initial?.intervalSec ?? kindMeta(initial?.kind ?? 'icmp').defaultIntervalSec)
  const [failThreshold, setFailThreshold] = useState(initial?.failThreshold ?? 3)
  const [config, setConfig] = useState<Record<string, unknown>>(initial?.config ?? {})
  const [tags, setTags] = useState(initial?.tags ?? '')
  const [channel, setChannel] = useState(initial?.channel ?? '')
  const [intervalTouched, setIntervalTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const meta = kindMeta(kind)

  // Switching kind on a *new* monitor pulls in that kind's sane interval + drops
  // stale config (an edit keeps whatever the user had).
  function pickKind(k: MonitorKind) {
    setKind(k)
    if (!initial) {
      setConfig({})
      if (!intervalTouched) setIntervalSec(kindMeta(k).defaultIntervalSec)
    }
  }

  const setCfg = (key: string, val: unknown) =>
    setConfig((c) => {
      const next = { ...c }
      if (val === '' || val === undefined || val === null) delete next[key]
      else next[key] = val
      return next
    })

  const submit = async () => {
    if (!name.trim() || !target.trim()) return
    setBusy(true)
    const saved = await save({
      id: initial?.id,
      name: name.trim(),
      kind,
      target: target.trim(),
      intervalSec,
      failThreshold,
      config,
      tags: tags.trim(),
      channel,
      dependsOn,
    })
    setBusy(false)
    if (saved) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit monitor" : "New monitor"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="mon-name">Name</Label>
            <Input id="mon-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="prod gateway" />
          </div>
          <div className="space-y-1">
            <Label>Check</Label>
            <Select value={kind} onValueChange={(v) => pickKind(v as MonitorKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.kind} value={k.kind}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="mon-target">{meta.targetLabel}</Label>
            <Input
              id="mon-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={meta.targetPlaceholder}
              className="font-mono"
            />
          </div>

          {meta.configFields.length > 0 && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border border-border/50 p-3">
              {meta.configFields.map((f) => (
                <ConfigInput key={f.key} field={f} value={config[f.key]} onChange={(v) => setCfg(f.key, v)} />
              ))}
            </div>
          )}

          {kind === 'ssh' && <SshConfig config={config} setCfg={setCfg} />}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="mon-interval">Interval (s)</Label>
              <Input
                id="mon-interval"
                type="number"
                min={5}
                value={intervalSec}
                onChange={(e) => {
                  setIntervalTouched(true)
                  setIntervalSec(Math.max(5, Number(e.target.value) || 60))
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mon-fails">Down after N fails</Label>
              <Input
                id="mon-fails"
                type="number"
                min={1}
                value={failThreshold}
                onChange={(e) => setFailThreshold(Math.max(1, Number(e.target.value) || 3))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="mon-tags">Tags</Label>
              <Input
                id="mon-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="prod, web"
              />
            </div>
            <div className="space-y-1">
              <Label>Alert channel</Label>
              <Select value={channel || 'default'} onValueChange={(v) => setChannel(!v || v === 'default' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Use default</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="desktop">Desktop</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Depends on</Label>
            <Select
              value={dependsOn || 'none'}
              onValueChange={(v) => setDependsOn(!v || v === 'none' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nothing</SelectItem>
                {allMonitors
                  .filter((m) => m.id !== initial?.id)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              While the parent is down, this monitor's own outage is recorded but not alerted.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim() || !target.trim()}>
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
