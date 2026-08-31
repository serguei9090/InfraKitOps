/**
 * Runbooks module — backend client. All calls go through the shared
 * `/api/v1` request helpers; the run stream uses the SSE client. The whole
 * module is backend-mandatory (RUNBOOK_MODULE_PLAN.md §2), so every function
 * here throws `BackendUnavailableError` when no backend is connected.
 */
import { backendGet, backendRequest } from './backendClient'
import { openStream, type StreamHandlers } from './sseClient'
import type {
  Preview,
  Run,
  Runbook,
  RunbookSpec,
  RunbookVersion,
  RunSchedule,
  SshNode,
  VaultSecretMeta,
  VaultStatus,
} from '@/core/runbook/runbookModel'

// Go marshals empty slices as `null`; coerce them back to arrays at the boundary
// so every consumer can treat these as real arrays.
const arr = <T,>(v: T[] | null | undefined): T[] => v ?? []

function normSpec(s: RunbookSpec | null): RunbookSpec | null {
  if (!s) return null
  return { ...s, tags: arr(s.tags), args: arr(s.args), steps: arr(s.steps) }
}
function normRunbook(rb: Runbook): Runbook {
  return {
    ...rb,
    versions: arr<RunbookVersion>(rb.versions).map((v) => ({ ...v, spec: normSpec(v.spec)! })),
    draft: normSpec(rb.draft),
  }
}
function normPreview(p: Preview): Preview {
  return {
    ...p,
    validation: arr(p.validation),
    steps: arr(p.steps),
    destructive: arr(p.destructive),
  }
}
function normRun(r: Run): Run {
  return { ...r, steps: arr(r.steps), args: r.args ?? {} }
}

// --- runbooks ----------------------------------------------------------

export const listRunbooks = () =>
  backendGet<{ runbooks: Runbook[] | null }>('/runbooks').then((r) => arr(r.runbooks).map(normRunbook))

export const getRunbook = (id: string) =>
  backendGet<{ runbook: Runbook }>(`/runbooks/${id}`).then((r) => normRunbook(r.runbook))

export const createRunbook = (spec: RunbookSpec) =>
  backendRequest<{ runbook: Runbook }>('POST', '/runbooks', { spec }).then((r) => normRunbook(r.runbook))

export const deleteRunbook = (id: string) =>
  backendRequest<unknown>('DELETE', `/runbooks/${id}`)

export const saveDraft = (id: string, spec: RunbookSpec) =>
  backendRequest<{ runbook: Runbook }>('PUT', `/runbooks/${id}/draft`, { spec }).then((r) => normRunbook(r.runbook))

export const discardDraft = (id: string) =>
  backendRequest<{ runbook: Runbook }>('DELETE', `/runbooks/${id}/draft`).then((r) => normRunbook(r.runbook))

export const saveVersion = (id: string, note?: string) =>
  backendRequest<{ runbook: Runbook }>('POST', `/runbooks/${id}/versions`, { note }).then((r) => normRunbook(r.runbook))

export const versionAction = (id: string, n: number, action: 'restore' | 'pin' | 'unpin') =>
  backendRequest<{ runbook: Runbook }>('POST', `/runbooks/${id}/versions/${n}/${action}`).then((r) => normRunbook(r.runbook))

export const deleteVersion = (id: string, n: number) =>
  backendRequest<{ runbook: Runbook }>('DELETE', `/runbooks/${id}/versions/${n}`).then((r) => normRunbook(r.runbook))

export const setPublished = (id: string, published: boolean) =>
  backendRequest<{ runbook: Runbook }>('POST', `/runbooks/${id}/publish`, { published }).then((r) => normRunbook(r.runbook))

export const previewRun = (id: string, args: Record<string, string>, version = 0) =>
  backendRequest<Preview>('POST', `/runbooks/${id}/preview`, { args, version }).then(normPreview)

// --- runs ------------------------------------------------------------

export const listRuns = (runbookId?: string, limit = 100) =>
  backendGet<{ runs: Run[] | null }>(`/runs?limit=${limit}${runbookId ? `&runbookId=${runbookId}` : ''}`).then((r) =>
    arr(r.runs).map(normRun),
  )

export const getRun = (id: number) =>
  backendGet<{ run: Run }>(`/runs/${id}`).then((r) => normRun(r.run))

/** Open the run stream. Returns an abort function. */
export function openRunStream(
  runbookId: string,
  opts: { args: Record<string, string>; version?: number; dryRun?: boolean; asAuthor?: boolean },
  handlers: StreamHandlers,
): () => void {
  const params: Record<string, string> = { args: JSON.stringify(opts.args) }
  if (opts.version) params.version = String(opts.version)
  if (opts.dryRun) params.dryRun = '1'
  if (opts.asAuthor) params.author = '1'
  return openStream(`/runbooks/${runbookId}/run/stream`, params, handlers)
}

// --- ssh nodes ------------------------------------------------------

export const listNodes = () =>
  backendGet<{ nodes: SshNode[] | null }>('/ssh-nodes').then((r) => arr(r.nodes))
export const putNode = (n: Partial<SshNode>) =>
  backendRequest<{ node: SshNode }>('POST', '/ssh-nodes', n).then((r) => r.node)
export const deleteNode = (id: string) => backendRequest<unknown>('DELETE', `/ssh-nodes/${id}`)

export interface NodeTestResult {
  ok: boolean
  hostKeyFp: string
  hostKeyLearned: boolean
  hostKeyMismatch: boolean
  error?: string
}
export const testNode = (id: string) =>
  backendRequest<NodeTestResult>('POST', `/ssh-nodes/${id}/test`)

// --- settings ------------------------------------------------------

export const getRunbookSettings = () =>
  backendGet<{ settings: Record<string, string> }>('/runbook-settings').then((r) => r.settings)
export const putRunbookSettings = (patch: Record<string, string>) =>
  backendRequest<{ settings: Record<string, string> }>('PUT', '/runbook-settings', patch).then((r) => r.settings)

// --- packages -----------------------------------------------------

export interface PackageTool {
  name: string
  present: boolean
  path?: string
  version?: string
  manager?: string
  installCmd?: string
  needsSudo?: boolean
}
export const listPackages = (extra?: string[]) =>
  backendGet<{ tools: PackageTool[] | null }>(`/packages${extra?.length ? `?extra=${extra.join(',')}` : ''}`).then(
    (r) => arr(r.tools),
  )
export function installPackage(tool: string, manager: string, handlers: StreamHandlers): () => void {
  return openStream('/packages/install/stream', { tool, manager }, handlers)
}

// --- library git / file sync ------------------------------------

export const libraryExport = (opts: { dir: string; gitCommit?: boolean; gitPush?: boolean }) =>
  backendRequest<{ report: string }>('POST', '/library/export', opts)
export const libraryImport = (dir: string) =>
  backendRequest<{ imported: number }>('POST', '/library/import', { dir })

// --- schedules ---------------------------------------------------

const normSchedule = (s: RunSchedule): RunSchedule => ({ ...s, args: s.args ?? {} })

export const listSchedules = () =>
  backendGet<{ schedules: RunSchedule[] | null }>('/runbook-schedules').then((r) =>
    arr(r.schedules).map(normSchedule),
  )
export const putSchedule = (s: Partial<RunSchedule>) =>
  backendRequest<{ schedule: RunSchedule }>(
    s.id ? 'PUT' : 'POST',
    s.id ? `/runbook-schedules/${s.id}` : '/runbook-schedules',
    s,
  ).then((r) => normSchedule(r.schedule))
export const deleteSchedule = (id: string) =>
  backendRequest<unknown>('DELETE', `/runbook-schedules/${id}`)

// --- vault --------------------------------------------------------

export const vaultStatus = () => backendGet<VaultStatus>('/vault/status')
export const vaultInit = (masterPassword: string) =>
  backendRequest<VaultStatus>('POST', '/vault/init', { masterPassword })
export const vaultUnlock = (masterPassword: string) =>
  backendRequest<VaultStatus>('POST', '/vault/unlock', { masterPassword })
export const vaultUnlockKeyring = () => backendRequest<VaultStatus>('POST', '/vault/unlock-keyring')
export const vaultRemember = () => backendRequest<VaultStatus>('POST', '/vault/remember')
export const vaultForget = () => backendRequest<VaultStatus>('POST', '/vault/forget')
export const vaultLock = () => backendRequest<VaultStatus>('POST', '/vault/lock')
export const listSecrets = () =>
  backendGet<{ secrets: VaultSecretMeta[] | null }>('/vault/secrets').then((r) => arr(r.secrets))
export const putSecret = (s: { id?: string; name: string; kind: string; notes?: string; value: string }) =>
  backendRequest<{ id: string }>(s.id ? 'PUT' : 'POST', s.id ? `/vault/secrets/${s.id}` : '/vault/secrets', s)
export const deleteSecret = (id: string) => backendRequest<unknown>('DELETE', `/vault/secrets/${id}`)
