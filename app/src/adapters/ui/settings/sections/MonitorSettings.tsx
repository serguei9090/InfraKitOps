import { useEffect, useState } from 'react'
import { useBackendStore } from '@/stores/backendStore'
import { useMonitorStore } from '@/stores/monitorStore'
import { defaultMonitorSettings, type MonitorSettings as Settings } from '@/core/monitor/monitorModel'
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

      <SettingsGroup title="Behaviour">
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
