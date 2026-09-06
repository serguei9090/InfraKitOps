import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { Copy, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { keepMonitoringInBackground, setKeepMonitoringInBackground } from '@/adapters/backend/desktopKeepAlive'
import {
  deleteStatusBoard,
  listStatusBoards,
  rotateStatusBoard,
  saveStatusBoard,
} from '@/adapters/backend/monitorClient'
import { useBackendStore } from '@/stores/backendStore'
import { useMonitorStore } from '@/stores/monitorStore'
import {
  defaultMonitorSettings,
  type MonitorSettings as Settings,
  type StatusBoard,
} from '@/core/monitor/monitorModel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingsGroup, SettingsRow } from '../SettingsScaffold'
import { InstanceSettingsNotice } from '../InstanceSettingsNotice'

/**
 * Settings → Monitors (MONITORS_MODULE_PLAN.md M3). Where alerts go + the
 * notification policy. Secrets are Vault refs (`{{secret:NAME}}`) — a stored
 * one comes back as "••••"; leave it to keep it, retype to change.
 */
export function MonitorSettings() {
  const status = useBackendStore((s) => s.status)
  const refreshBackend = useBackendStore((s) => s.refresh)
  const stored = useMonitorStore((s) => s.settings)
  const loadSettings = useMonitorStore((s) => s.loadSettings)
  const saveSettings = useMonitorStore((s) => s.saveSettings)
  const testChannel = useMonitorStore((s) => s.testChannel)

  const [draft, setDraft] = useState<Settings>(defaultMonitorSettings())
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [keepAlive, setKeepAlive] = useState(keepMonitoringInBackground())

  const setKeepAlivePref = (on: boolean) => {
    setKeepAlive(on)
    void setKeepMonitoringInBackground(on)
  }

  useEffect(() => {
    if (status === 'unknown') void refreshBackend()
  }, [status, refreshBackend])
  useEffect(() => {
    if (status === 'available') void loadSettings()
  }, [status, loadSettings])
  useEffect(() => {
    if (!dirty) setDraft(stored)
  }, [stored, dirty])

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((d) => ({ ...d, [k]: v }))
    setDirty(true)
  }
  const setWebhook = (patch: Partial<Settings['webhook']>) => {
    setDraft((d) => ({ ...d, webhook: { ...d.webhook, ...patch } }))
    setDirty(true)
  }
  const setSmtp = (patch: Partial<Settings['smtp']>) => {
    setDraft((d) => ({ ...d, smtp: { ...d.smtp, ...patch } }))
    setDirty(true)
  }

  const save = async () => {
    setBusy(true)
    const ok = await saveSettings(draft)
    setBusy(false)
    if (ok) setDirty(false)
  }
  const runTest = async (channel: string) => {
    if (dirty) await save()
    setTesting(channel)
    await testChannel(channel)
    setTesting(null)
  }

  if (status !== 'available') {
    return (
      <SettingsGroup title="Monitors">
        <p className="text-sm text-muted-foreground">
          Connect a backend (Settings → Backend) to configure monitor alerts.
        </p>
      </SettingsGroup>
    )
  }

  return (
    <>
      <InstanceSettingsNotice />

      <SettingsGroup title="Alerting" description="Where a monitor sends its down / recovered notifications.">
        <SettingsRow label="Default channel" hint="per-monitor override wins">
          <Select value={draft.defaultChannel || 'none'} onValueChange={(v) => set('defaultChannel', v === 'none' ? '' : (v as Settings['defaultChannel']))}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="webhook">Webhook</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="desktop">Desktop</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Webhook" description="Slack / Discord incoming webhook, or any endpoint (generic JSON).">
        <SettingsRow label="URL">
          <Input
            className="w-72 font-mono text-xs"
            value={draft.webhook.url}
            onChange={(e) => setWebhook({ url: e.target.value })}
            placeholder="https://hooks.slack.com/services/…"
          />
        </SettingsRow>
        <SettingsRow label="Format">
          <Select value={draft.webhook.format} onValueChange={(v) => setWebhook({ format: v as Settings['webhook']['format'] })}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="slack">Slack</SelectItem>
              <SelectItem value="discord">Discord</SelectItem>
              <SelectItem value="generic">Generic JSON</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="Auth token" hint="Optional — a {{secret:NAME}} Vault ref">
          <Input
            className="w-72 font-mono text-xs"
            value={draft.webhook.secret}
            onChange={(e) => setWebhook({ secret: e.target.value })}
            placeholder="{{secret:SLACK_HOOK}}"
          />
        </SettingsRow>
        <div className="flex justify-end">
          <Button size="sm" variant="outline" disabled={testing !== null || !draft.webhook.url} onClick={() => void runTest('webhook')}>
            {testing === 'webhook' ? 'Sending…' : 'Send test'}
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Email (SMTP)">
        <SettingsRow label="Host">
          <Input className="w-56" value={draft.smtp.host} onChange={(e) => setSmtp({ host: e.target.value })} placeholder="smtp.example.com" />
        </SettingsRow>
        <SettingsRow label="Port">
          <Input
            className="w-24"
            type="number"
            value={draft.smtp.port}
            onChange={(e) => setSmtp({ port: Number(e.target.value) || 587 })}
          />
        </SettingsRow>
        <SettingsRow label="Security">
          <Select value={draft.smtp.security} onValueChange={(v) => setSmtp({ security: v as Settings['smtp']['security'] })}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="starttls">STARTTLS</SelectItem>
              <SelectItem value="tls">TLS</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="Username">
          <Input className="w-56" value={draft.smtp.username} onChange={(e) => setSmtp({ username: e.target.value })} />
        </SettingsRow>
        <SettingsRow label="Password" hint="A Vault ref: {{secret:NAME}}">
          <Input
            className="w-56 font-mono text-xs"
            value={draft.smtp.password}
            onChange={(e) => setSmtp({ password: e.target.value })}
            placeholder="{{secret:SMTP_PASS}}"
          />
        </SettingsRow>
        <SettingsRow label="From">
          <Input className="w-56" value={draft.smtp.from} onChange={(e) => setSmtp({ from: e.target.value })} placeholder="alerts@example.com" />
        </SettingsRow>
        <SettingsRow label="To" hint="Comma-separated.">
          <Input className="w-56" value={draft.smtp.to} onChange={(e) => setSmtp({ to: e.target.value })} placeholder="me@example.com" />
        </SettingsRow>
        <div className="flex justify-end">
          <Button size="sm" variant="outline" disabled={testing !== null || !draft.smtp.host} onClick={() => void runTest('email')}>
            {testing === 'email' ? 'Sending…' : 'Send test'}
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Policy" description="Defaults; a monitor can override the timings.">
        <SettingsRow label="Alert after (s)" hint="0 = notify immediately">
          <Input
            className="w-24"
            type="number"
            value={draft.alertAfterSec}
            onChange={(e) => set('alertAfterSec', Math.max(0, Number(e.target.value) || 0))}
          />
        </SettingsRow>
        <SettingsRow label="Re-notify every (s)" hint="0 = notify once">
          <Input
            className="w-24"
            type="number"
            value={draft.renotifyEverySec}
            onChange={(e) => set('renotifyEverySec', Math.max(0, Number(e.target.value) || 0))}
          />
        </SettingsRow>
        <SettingsRow label="Notify on recovery">
          <Switch checked={draft.notifyOnRecovery} onCheckedChange={(v) => set('notifyOnRecovery', v)} />
        </SettingsRow>
      </SettingsGroup>

      <StatusPagesGroup />

      <SettingsGroup title="Behaviour">
        {isTauri() && (
          <SettingsRow label="Keep monitoring when the window is closed" hint="Minimises to the tray; the backend keeps running">
            <Switch checked={keepAlive} onCheckedChange={setKeepAlivePref} />
          </SettingsRow>
        )}
        <SettingsRow label="Probe all monitors on start" hint="Probe once on backend start">
          <Switch checked={draft.runAllOnStart} onCheckedChange={(v) => set('runAllOnStart', v)} />
        </SettingsRow>
      </SettingsGroup>

      <div className="flex items-center gap-3">
        <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save alert settings'}
        </Button>
        {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
      </div>
    </>
  )
}

/**
 * Status pages (M5) — token-addressed public read-only boards. Each is a
 * shareable `/status/<token>` URL scoped to a tag filter.
 */
function StatusPagesGroup() {
  const [boards, setBoards] = useState<StatusBoard[]>([])
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const reload = () => listStatusBoards().then(setBoards).catch(() => setBoards([]))
  useEffect(() => {
    void reload()
  }, [])

  const linkFor = (b: StatusBoard) => `${window.location.origin}/status/${b.token}`

  const add = async () => {
    setBusy(true)
    try {
      await saveStatusBoard({ title: title.trim(), tags: tags.trim(), showIncidents: true })
      setTitle('')
      setTags('')
      await reload()
    } finally {
      setBusy(false)
    }
  }
  const copy = async (b: StatusBoard) => {
    try {
      await navigator.clipboard.writeText(linkFor(b))
      setCopied(b.id)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <SettingsGroup title="Status pages" description="Public read-only pages — name, status and uptime only.">
      {boards.map((b) => (
        <div key={b.id} className="space-y-1.5 rounded-md border border-border/50 p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{b.title || 'Untitled'}</span>
            <span className="text-xs text-muted-foreground">{b.tags ? `tags: ${b.tags}` : 'all monitors'}</span>
            <div className="flex-1" />
            <Switch
              checked={b.showIncidents}
              onCheckedChange={(v) => void saveStatusBoard({ ...b, showIncidents: v }).then(reload)}
              aria-label="Show incidents"
            />
            <span className="text-[11px] text-muted-foreground">incidents</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Input readOnly value={linkFor(b)} className="h-7 flex-1 font-mono text-[11px]" />
            <Button size="xs" variant="outline" onClick={() => void copy(b)}>
              <Copy className="size-3" /> {copied === b.id ? 'Copied' : 'Copy'}
            </Button>
            <Button
              size="xs"
              variant="outline"
              title="Issue a new token — the old link stops working"
              onClick={() => void rotateStatusBoard(b.id).then(reload)}
            >
              <RefreshCw className="size-3" />
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                if (confirm('Delete this status page?')) void deleteStatusBoard(b.id).then(reload)
              }}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        </div>
      ))}
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Acme status" className="h-8" />
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">Tags (optional)</label>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="prod, public" className="h-8" />
        </div>
        <Button size="sm" disabled={busy} onClick={() => void add()}>
          <Plus className="size-4" /> Add
        </Button>
      </div>
    </SettingsGroup>
  )
}
