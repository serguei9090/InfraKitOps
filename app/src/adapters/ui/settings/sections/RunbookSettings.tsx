import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { useBackendStore } from '@/stores/backendStore'
import { getRunbookSettings, putRunbookSettings } from '@/adapters/backend/runbookClient'
import { SettingsGroup, SettingsRow } from '../SettingsScaffold'
import { SettingsResetButton } from '../SettingsResetButton'
import { InstanceSettingsNotice } from '../InstanceSettingsNotice'

const DEFAULTS: Record<string, number> = {
  historyRetentionDays: 90,
  historyMaxPerRunbook: 20,
  vaultAutoLockMinutes: 15,
  maxConcurrentRuns: 4,
}

export function RunbookSettings() {
  const status = useBackendStore((s) => s.status)
  const refreshBackend = useBackendStore((s) => s.refresh)
  const [values, setValues] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (status === 'unknown') void refreshBackend()
  }, [status, refreshBackend])

  useEffect(() => {
    if (status !== 'available') return
    void getRunbookSettings()
      .then((s) => {
        setValues(s)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [status])

  function num(key: string): number {
    const v = values[key]
    return v && !Number.isNaN(Number(v)) ? Number(v) : DEFAULTS[key]
  }

  async function save(key: string, raw: string) {
    const n = Math.max(0, Math.round(Number(raw) || 0))
    setValues((v) => ({ ...v, [key]: String(n) }))
    const merged = await putRunbookSettings({ [key]: String(n) })
    setValues(merged)
  }

  if (status !== 'available') {
    return (
      <SettingsGroup title="Runbooks">
        <p className="text-sm text-muted-foreground">Connect a backend (Settings → Backend) to change Runbooks settings.</p>
      </SettingsGroup>
    )
  }

  return (
    <>
      <InstanceSettingsNotice />
      <SettingsGroup
        title="Run history"
        description="Applied on the next run's prune pass. Pinned runs are always kept."
      >
        <SettingsRow label="Retention" hint="Runs older than this are removed (days).">
          <NumInput value={num('historyRetentionDays')} disabled={!loaded} onCommit={(v) => save('historyRetentionDays', v)} />
        </SettingsRow>
        <SettingsRow label="Keep per runbook" hint="Newest N runs are always kept regardless of age.">
          <NumInput value={num('historyMaxPerRunbook')} disabled={!loaded} onCommit={(v) => save('historyMaxPerRunbook', v)} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Execution">
        <SettingsRow label="Max concurrent runs" hint="0 = unlimited. Applies to new runs immediately.">
          <NumInput value={num('maxConcurrentRuns')} disabled={!loaded} onCommit={(v) => save('maxConcurrentRuns', v)} />
        </SettingsRow>
        <SettingsRow label="Vault auto-lock" hint="Idle minutes before the Vault locks itself. 0 = never.">
          <NumInput value={num('vaultAutoLockMinutes')} disabled={!loaded} onCommit={(v) => save('vaultAutoLockMinutes', v)} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsResetButton
        onReset={async () => {
          const merged = await putRunbookSettings(
            Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, String(v)])),
          )
          setValues(merged)
        }}
      />
    </>
  )
}

function NumInput({
  value,
  disabled,
  onCommit,
}: {
  value: number
  disabled?: boolean
  onCommit: (raw: string) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return (
    <Input
      type="number"
      min={0}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== String(value) && onCommit(draft)}
      className="h-8 w-24 text-xs"
    />
  )
}
