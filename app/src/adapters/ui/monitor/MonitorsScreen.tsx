import { useEffect, useMemo, useState } from 'react'
import { Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useBackendStore } from '@/stores/backendStore'
import { useMonitorStore } from '@/stores/monitorStore'
import {
  KINDS,
  kindMeta,
  relTime,
  STATUS_DOT,
  uptimePct,
  type Monitor,
  type MonitorKind,
  type MonitorSample,
} from '@/core/monitor/monitorModel'
import { LatencyChart } from '@/adapters/ui/network'
import { BackendUnavailable } from '@/adapters/ui/network/BackendUnavailable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

const NO_SAMPLES: MonitorSample[] = []

/**
 * Monitors status board (MONITORS_MODULE_PLAN.md M1). Left: every monitor with
 * its live status; right: the selected monitor's history + controls. Checks run
 * server-side — this page just watches them.
 */
export function MonitorsScreen() {
  const status = useBackendStore((s) => s.status)
  const refreshBackend = useBackendStore((s) => s.refresh)
  const reconnecting = useBackendStore((s) => s.reconnecting)

  const monitors = useMonitorStore((s) => s.monitors)
  const loaded = useMonitorStore((s) => s.loaded)
  const selectedId = useMonitorStore((s) => s.selectedId)
  const startPolling = useMonitorStore((s) => s.startPolling)
  const stopPolling = useMonitorStore((s) => s.stopPolling)
  const select = useMonitorStore((s) => s.select)

  const [editing, setEditing] = useState<Monitor | 'new' | null>(null)

  useEffect(() => {
    if (status === 'unknown') void refreshBackend()
  }, [status, refreshBackend])

  useEffect(() => {
    if (status === 'available') startPolling()
    return () => stopPolling()
  }, [status, startPolling, stopPolling])

  if (status === 'unavailable') {
    return <BackendUnavailable onRetry={refreshBackend} retrying={reconnecting} />
  }

  const selected = monitors.find((m) => m.id === selectedId) ?? null

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4">
        <h1 className="text-sm font-semibold">Monitors</h1>
        <span className="text-xs text-muted-foreground">
          {monitors.length} · {monitors.filter((m) => m.status === 'down').length} down
        </span>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="size-4" /> New monitor
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="w-[22rem] shrink-0 overflow-y-auto border-r border-border/60">
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
                active={m.id === selectedId}
                onClick={() => void select(m.id === selectedId ? null : m.id)}
              />
            ))
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto">
          {selected ? (
            <MonitorDetail m={selected} onEdit={() => setEditing(selected)} />
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
    </div>
  )
}

function MonitorRow({ m, active, onClick }: { m: Monitor; active: boolean; onClick: () => void }) {
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
        <div className="truncate text-sm font-medium">{m.name}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {m.kind} · {m.target}
        </div>
      </div>
      <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
        {m.status === 'paused' ? 'paused' : relTime(m.lastCheckedAt)}
      </span>
    </button>
  )
}

function MonitorDetail({ m, onEdit }: { m: Monitor; onEdit: () => void }) {
  const samples = useMonitorStore((s) => (s.samplesFor === m.id ? s.samples : NO_SAMPLES))
  const setPaused = useMonitorStore((s) => s.setPaused)
  const remove = useMonitorStore((s) => s.remove)
  const checkNow = useMonitorStore((s) => s.checkNow)
  const meta = kindMeta(m.kind)

  const series = useMemo(
    () => [
      {
        host: m.name,
        color: m.status === 'down' ? '#ef4444' : '#4f46e5',
        points: samples.map((s) => ({ t: s.t, ms: s.ok ? s.value : null })),
      },
    ],
    [samples, m.name, m.status],
  )
  const windowSec = useMemo(() => {
    if (samples.length < 2) return 300
    const span = (samples[samples.length - 1].t - samples[0].t) / 1000
    return Math.max(300, Math.ceil(span) + 60)
  }, [samples])

  const up = uptimePct(samples)
  const last = samples.at(-1)

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-start gap-3">
        <span className={cn('mt-1.5 size-3 shrink-0 rounded-full', STATUS_DOT[m.status])} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{m.name}</h2>
            <span className="text-xs uppercase text-muted-foreground">{m.status}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {meta.label} · <span className="font-mono">{m.target}</span> · every {m.intervalSec}s ·{' '}
            down after {m.failThreshold} fails
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="outline" onClick={() => void checkNow(m.id)}>
            <RefreshCw className="size-3.5" /> Check now
          </Button>
          <Button size="sm" variant="outline" onClick={() => void setPaused(m.id, m.enabled)}>
            {m.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {m.enabled ? 'Pause' : 'Resume'}
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit}>
            Edit
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
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <Stat label="uptime (window)" value={up == null ? '—' : `${up}%`} />
        <Stat
          label={`last ${meta.unit || 'result'}`}
          value={last ? (meta.unit ? `${Math.round(last.value)} ${meta.unit}` : last.ok ? 'ok' : 'fail') : '—'}
        />
        <Stat label="samples" value={String(samples.length)} />
      </div>

      {samples.length >= 2 ? (
        <LatencyChart series={series} windowSec={windowSec} height={180} />
      ) : (
        <p className="text-xs text-muted-foreground">Waiting for enough samples to chart…</p>
      )}

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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <p className="font-mono text-lg tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}

function MonitorDialog({ initial, onClose }: { initial: Monitor | null; onClose: () => void }) {
  const save = useMonitorStore((s) => s.save)
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<MonitorKind>(initial?.kind ?? 'icmp')
  const [target, setTarget] = useState(initial?.target ?? '')
  const [intervalSec, setIntervalSec] = useState(initial?.intervalSec ?? 60)
  const [failThreshold, setFailThreshold] = useState(initial?.failThreshold ?? 3)
  const [busy, setBusy] = useState(false)
  const meta = kindMeta(kind)

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
    })
    setBusy(false)
    if (saved) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit monitor' : 'New monitor'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="mon-name">Name</Label>
            <Input id="mon-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="prod gateway" />
          </div>
          <div className="space-y-1">
            <Label>Check</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as MonitorKind)}>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="mon-interval">Interval (s)</Label>
              <Input
                id="mon-interval"
                type="number"
                min={5}
                value={intervalSec}
                onChange={(e) => setIntervalSec(Math.max(5, Number(e.target.value) || 60))}
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim() || !target.trim()}>
            {initial ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
