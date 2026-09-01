/**
 * S3b — export / import all settings as one JSON blob. **No secrets**: the
 * MaxMind key, Vault contents, and connection API-key ids are never included.
 * Import is a merge — whatever the file carries is applied, the rest untouched.
 */
import { useThemeStore } from '@/stores/themeStore'
import { useModuleVisibilityStore } from '@/stores/moduleVisibilityStore'
import { useNetworkSettingsStore } from '@/stores/networkSettingsStore'
import { getLlmSettings, putLlmSettings } from '@/adapters/backend/llmClient'
import { getRunbookSettings, putRunbookSettings } from '@/adapters/backend/runbookClient'

export interface SettingsBackup {
  version: 1
  exportedAt: string
  client: {
    theme: 'light' | 'dark'
    modules: { order: string[]; hiddenIds: string[]; railExpanded: boolean }
    network: Record<string, unknown>
  }
  ai?: Record<string, string>
  runbooks?: Record<string, string>
}

/** Network settings minus credentials (MaxMind key, proxy user/password). */
function networkNoSecrets(): Record<string, unknown> {
  const {
    update: _u,
    reset: _r,
    maxmindLicenseKey: _k,
    proxyUser: _pu,
    proxyPassword: _pp,
    ...rest
  } = useNetworkSettingsStore.getState()
  return rest as Record<string, unknown>
}

export async function buildBackup(backendAvailable: boolean): Promise<SettingsBackup> {
  const t = useThemeStore.getState()
  const m = useModuleVisibilityStore.getState()
  const out: SettingsBackup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    client: {
      theme: t.mode,
      modules: { order: m.order, hiddenIds: m.hiddenIds, railExpanded: m.railExpanded },
      network: networkNoSecrets(),
    },
  }
  if (backendAvailable) {
    out.ai = await getLlmSettings().catch(() => undefined)
    out.runbooks = await getRunbookSettings().catch(() => undefined)
  }
  return out
}

export async function applyBackup(raw: unknown): Promise<void> {
  const data = raw as SettingsBackup
  if (!data || data.version !== 1) throw new Error('not a valid settings backup (version 1)')

  const c = data.client
  if (c?.theme === 'light' || c?.theme === 'dark') useThemeStore.setState({ mode: c.theme })
  if (c?.modules && Array.isArray(c.modules.order)) {
    useModuleVisibilityStore.setState({
      order: c.modules.order,
      hiddenIds: Array.isArray(c.modules.hiddenIds) ? c.modules.hiddenIds : [],
      railExpanded: Boolean(c.modules.railExpanded),
    })
  }
  if (c?.network && typeof c.network === 'object') {
    useNetworkSettingsStore.getState().update(c.network as never)
  }
  if (data.ai && typeof data.ai === 'object') await putLlmSettings(data.ai)
  if (data.runbooks && typeof data.runbooks === 'object') await putRunbookSettings(data.runbooks)
}

export function downloadBackup(b: SettingsBackup): void {
  const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `infrakit-settings-${b.exportedAt.slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
