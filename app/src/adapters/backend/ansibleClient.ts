/**
 * Ansible Manager module — backend client. Backend-mandatory: every call goes
 * through the shared `/api/v1` helpers and throws `BackendUnavailableError`
 * when no backend is connected. The run + runtime-setup streams use SSE.
 * See ANSIBLE_MODULE_PLAN.md.
 */
import { backendGet, backendRequest } from './backendClient'
import { openStream, type StreamHandlers } from './sseClient'
import type {
  AnsibleSettings,
  InventoryResult,
  Job,
  Project,
  ProjectTree,
  Run,
  RunSpec,
  Schedule,
} from '@/core/ansible/ansibleModel'

const arr = <T,>(v: T[] | null | undefined): T[] => v ?? []

// --- settings + runtime --------------------------------------------

export const getSettings = () => backendGet<AnsibleSettings>('/ansible/settings')

export const putSettings = (patch: {
  workspaceDir?: string
  runtime?: string
  containerImage?: string
  controlNodePipPackages?: string
  controlNodeCollections?: string
  wslDistro?: string
  wslSource?: string
}) => backendRequest<AnsibleSettings>('PUT', '/ansible/settings', patch)

/** Provision a runtime: mode "managed" → uv venv, "container" → build/pull the image. */
export function setupRuntime(mode: string, handlers: StreamHandlers): () => void {
  return openStream('/ansible/runtime/setup/stream', { mode }, handlers)
}

export const teardownRuntime = (mode: string) =>
  backendRequest<{ status: string }>('POST', '/ansible/runtime/teardown', { mode })

// --- projects -----------------------------------------------------

export const listProjects = () =>
  backendGet<{ projects: Project[] | null }>('/ansible/projects').then((r) => arr(r.projects))

export const createProject = (body: {
  name: string
  mode: 'new' | 'existing' | 'git'
  path?: string
  gitUrl?: string
  gitRef?: string
  gitSecret?: string
}) => backendRequest<{ project: Project }>('POST', '/ansible/projects', body).then((r) => r.project)

export const deleteProject = (id: string) =>
  backendRequest<unknown>('DELETE', `/ansible/projects/${id}`)

export const pullProject = (id: string) =>
  backendRequest<{ output: string; project: Project }>('POST', `/ansible/projects/${id}/pull`)

export const publishProject = (id: string, published: boolean) =>
  backendRequest<{ project: Project }>('POST', `/ansible/projects/${id}/publish`, { published }).then(
    (r) => r.project,
  )

export const publishJob = (id: string, published: boolean) =>
  backendRequest<{ job: Job }>('POST', `/ansible/jobs/${id}/publish`, { published }).then((r) => r.job)

// --- run approvals (U3) ---------------------------------------

export const listPendingApprovals = () =>
  backendGet<{ runs: Run[] | null }>('/ansible/runs/pending-approvals').then((r) => arr(r.runs))

export const approveRun = (id: number, approved: boolean) =>
  backendRequest<{ status: string; approved: boolean }>('POST', `/ansible/runs/${id}/approve`, { approved })

export const projectTree = (id: string) =>
  backendGet<{ tree: ProjectTree }>(`/ansible/projects/${id}/tree`).then((r) => r.tree)

// --- project files + inventory -----------------------------------

export const readProjectFile = (id: string, path: string) =>
  backendGet<{ path: string; content: string }>(
    `/ansible/projects/${id}/file?path=${encodeURIComponent(path)}`,
  )

export const writeProjectFile = (id: string, path: string, content: string) =>
  backendRequest<{ status: string }>(
    'PUT',
    `/ansible/projects/${id}/file?path=${encodeURIComponent(path)}`,
    { content },
  )

export const readInventory = (id: string, src?: string) =>
  backendGet<{ inventory: InventoryResult }>(
    `/ansible/projects/${id}/inventory${src ? `?src=${encodeURIComponent(src)}` : ''}`,
  ).then((r) => r.inventory)

// --- jobs -------------------------------------------------------

export const listJobs = (projectId?: string) =>
  backendGet<{ jobs: Job[] | null }>(
    `/ansible/jobs${projectId ? `?projectId=${projectId}` : ''}`,
  ).then((r) => arr(r.jobs))

export const putJob = (job: Partial<Job>) =>
  backendRequest<{ job: Job }>(
    job.id ? 'PUT' : 'POST',
    job.id ? `/ansible/jobs/${job.id}` : '/ansible/jobs',
    job,
  ).then((r) => r.job)

export const deleteJob = (id: string) => backendRequest<unknown>('DELETE', `/ansible/jobs/${id}`)

export function openJobRunStream(
  jobId: string,
  handlers: StreamHandlers,
  extraVars?: string,
): () => void {
  return openStream(
    `/ansible/jobs/${jobId}/run/stream`,
    extraVars ? { extraVars } : {},
    handlers,
  )
}

// --- schedules -------------------------------------------------

export const listSchedules = () =>
  backendGet<{ schedules: Schedule[] | null }>('/ansible/schedules').then((r) => arr(r.schedules))
export const putSchedule = (s: Partial<Schedule>) =>
  backendRequest<{ schedule: Schedule }>(
    s.id ? 'PUT' : 'POST',
    s.id ? `/ansible/schedules/${s.id}` : '/ansible/schedules',
    s,
  ).then((r) => r.schedule)
export const deleteSchedule = (id: string) =>
  backendRequest<unknown>('DELETE', `/ansible/schedules/${id}`)

// --- ansible-vault --------------------------------------------

export interface VaultActionResult {
  op: string
  ok: boolean
  content?: string
  output?: string
}
export const vaultAction = (
  projectId: string,
  body: { path: string; op: 'encrypt' | 'decrypt' | 'view' | 'rekey'; secret: string; newSecret?: string },
) =>
  backendRequest<{ result: VaultActionResult }>('POST', `/ansible/projects/${projectId}/vault`, body).then(
    (r) => r.result,
  )

// --- ad-hoc, doc, checks --------------------------------------------

export interface AdhocSpec {
  projectId: string
  pattern: string
  module: string
  args: string
  inventory?: string
  become?: boolean
}

export function openAdhocStream(spec: AdhocSpec, handlers: StreamHandlers): () => void {
  const p: Record<string, string> = {
    projectId: spec.projectId,
    pattern: spec.pattern || 'all',
    module: spec.module || 'command',
    args: spec.args ?? '',
  }
  if (spec.inventory) p.inventory = spec.inventory
  if (spec.become) p.become = '1'
  return openStream('/ansible/adhoc/stream', p, handlers)
}

export interface ModuleDoc {
  module: string
  shortDescription: string
  description: string[]
  options: Record<
    string,
    { description: string[]; type?: string; required?: boolean; default?: unknown; choices?: unknown }
  >
  examples: string
}
export const moduleDoc = (module: string) =>
  backendGet<{ doc: ModuleDoc }>(`/ansible/doc?module=${encodeURIComponent(module)}`).then((r) => r.doc)

export interface CheckResult {
  kind: 'syntax' | 'lint'
  ok: boolean
  output?: string
  issues?: { rule: string; message: string; severity: string; line: number; path: string }[]
  ran: boolean
  reason?: string
}
export const syntaxCheck = (projectId: string, playbook: string) =>
  backendRequest<{ result: CheckResult }>('POST', `/ansible/projects/${projectId}/syntax-check`, {
    playbook,
  }).then((r) => r.result)
export const lint = (projectId: string, path: string) =>
  backendRequest<{ result: CheckResult }>('POST', `/ansible/projects/${projectId}/lint`, { path }).then(
    (r) => r.result,
  )

// --- galaxy content ----------------------------------------------

export interface GalaxyItem {
  type: 'role' | 'collection'
  name: string
  description?: string
  version?: string
  downloads?: number
}
export const galaxySearch = (type: '' | 'role' | 'collection', q: string) =>
  backendGet<{ items: GalaxyItem[] | null }>(
    `/ansible/galaxy/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`,
  ).then((r) => arr(r.items))

/** Install one item, or everything in requirements.yml when name is omitted. */
export function openGalaxyInstallStream(
  projectId: string,
  opts: { type?: 'role' | 'collection'; name?: string },
  handlers: StreamHandlers,
): () => void {
  const p: Record<string, string> = {}
  if (opts.type) p.type = opts.type
  if (opts.name) p.name = opts.name
  return openStream(`/ansible/projects/${projectId}/galaxy/install/stream`, p, handlers)
}

// --- runs -------------------------------------------------------

export const listRuns = (projectId?: string, limit = 100) =>
  backendGet<{ runs: Run[] | null }>(
    `/ansible/runs?limit=${limit}${projectId ? `&projectId=${projectId}` : ''}`,
  ).then((r) => arr(r.runs))

export const getRun = (id: number) =>
  backendGet<{ run: Run }>(`/ansible/runs/${id}`).then((r) => r.run)

/** Open a playbook run stream. Returns an abort function. */
export function openRunStream(spec: RunSpec, handlers: StreamHandlers): () => void {
  const p: Record<string, string> = { playbook: spec.playbook }
  if (spec.inventory) p.inventory = spec.inventory
  if (spec.limit) p.limit = spec.limit
  if (spec.tags) p.tags = spec.tags
  if (spec.skipTags) p.skipTags = spec.skipTags
  if (spec.extraVars) p.extraVars = spec.extraVars
  if (spec.check) p.check = '1'
  if (spec.diff) p.diff = '1'
  if (spec.become) p.become = '1'
  if (spec.verbosity) p.verbosity = String(spec.verbosity)
  if (spec.forks) p.forks = String(spec.forks)
  return openStream(`/ansible/projects/${spec.projectId}/run/stream`, p, handlers)
}
