import { backendGet, backendPost, backendRequest } from './backendClient'
import type { RunEnvelope, RunSummary, StoredRun } from '@/core/network/history'
import { useNetworkSettingsStore } from '@/stores/networkSettingsStore'
import {
  localDeleteRun,
  localGetRun,
  localLabelRun,
  localListRuns,
  localPinRun,
  localSaveRun,
} from '@/adapters/storage/localHistoryStore'

/**
 * Frontend side of the sidecar's `/api/v1/history`. Tools call `saveRun` after
 * every run (respecting the module's auto-save setting); the History drawer and
 * Compare view use the read calls. See NETWORK_MODULE_PLAN.md §2.3.
 *
 * When the backend is unreachable (the pure-web build with no standalone
 * service), every call transparently falls back to `localHistoryStore`, an
 * IndexedDB store with the same shapes and prune policy.
 */

function prunePolicy() {
  const s = useNetworkSettingsStore.getState()
  return { retentionDays: s.historyRetentionDays, maxPerTarget: s.historyMaxPerTarget }
}

/** Persist a run. Returns its id, or null if auto-save is off. */
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
  } catch {
    // Backend down or history disabled — keep it locally instead.
    return localSaveRun(env, prunePolicy())
  }
}

export async function listRuns(tool: string, target?: string, limit = 100): Promise<RunSummary[]> {
  const qs = new URLSearchParams({ tool, limit: String(limit) })
  if (target) qs.set('target', target)
  try {
    const { runs } = await backendGet<{ runs: RunSummary[] }>(`/history?${qs}`)
    return runs
  } catch {
    return localListRuns(tool, target, limit)
  }
}

export async function getRun(id: number): Promise<StoredRun | null> {
  try {
    return await backendGet<StoredRun>(`/history/${id}`)
  } catch {
    return localGetRun(id)
  }
}

export async function pinRun(id: number, pinned: boolean): Promise<void> {
  try {
    await backendRequest('PATCH', `/history/${id}`, { pinned })
  } catch {
    await localPinRun(id, pinned)
  }
}

export async function labelRun(id: number, label: string): Promise<void> {
  try {
    await backendRequest('PATCH', `/history/${id}`, { label })
  } catch {
    await localLabelRun(id, label)
  }
}

export async function deleteRun(id: number): Promise<void> {
  try {
    await backendRequest('DELETE', `/history/${id}`)
  } catch {
    await localDeleteRun(id)
  }
}
