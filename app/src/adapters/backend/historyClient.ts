import { backendGet, backendPost, backendRequest, BackendUnavailableError } from './backendClient'
import type { RunEnvelope, RunSummary, StoredRun } from '@/core/network/history'
import { useNetworkSettingsStore } from '@/stores/networkSettingsStore'

/**
 * Frontend side of the sidecar's `/api/v1/history`. Tools call `saveRun` after
 * every run (respecting the module's auto-save setting); the History drawer and
 * Compare view use the read calls. See NETWORK_MODULE_PLAN.md §2.3.
 */

/** Persist a run. Returns its id, or null if auto-save is off / history unavailable. */
export async function saveRun(env: RunEnvelope): Promise<number | null> {
  const s = useNetworkSettingsStore.getState()
  if (!s.autoSaveHistory) return null
  const qs = new URLSearchParams({
    retentionDays: String(s.historyRetentionDays),
    maxPerTarget: String(s.historyMaxPerTarget),
  })
  try {
    const { id } = await backendPost<{ id: number }>(`/history?${qs}`, env)
    return id
  } catch (e) {
    if (e instanceof BackendUnavailableError) return null
    return null // a 503 (history disabled) must not break the tool
  }
}

export async function listRuns(tool: string, target?: string, limit = 100): Promise<RunSummary[]> {
  const qs = new URLSearchParams({ tool, limit: String(limit) })
  if (target) qs.set('target', target)
  try {
    const { runs } = await backendGet<{ runs: RunSummary[] }>(`/history?${qs}`)
    return runs
  } catch {
    return []
  }
}

export async function getRun(id: number): Promise<StoredRun | null> {
  try {
    return await backendGet<StoredRun>(`/history/${id}`)
  } catch {
    return null
  }
}

export async function pinRun(id: number, pinned: boolean): Promise<void> {
  await backendRequest('PATCH', `/history/${id}`, { pinned })
}

export async function labelRun(id: number, label: string): Promise<void> {
  await backendRequest('PATCH', `/history/${id}`, { label })
}

export async function deleteRun(id: number): Promise<void> {
  await backendRequest('DELETE', `/history/${id}`)
}
