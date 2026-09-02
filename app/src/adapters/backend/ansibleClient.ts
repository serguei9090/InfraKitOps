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
  Project,
  ProjectTree,
  Run,
  RunSpec,
} from '@/core/ansible/ansibleModel'

const arr = <T,>(v: T[] | null | undefined): T[] => v ?? []

// --- settings + runtime --------------------------------------------

export const getSettings = () => backendGet<AnsibleSettings>('/ansible/settings')

export const putSettings = (patch: { workspaceDir?: string; runtime?: string }) =>
  backendRequest<AnsibleSettings>('PUT', '/ansible/settings', patch)

/** Stream `uv venv` + `uv pip install ansible-core` output. Returns an abort fn. */
export function setupManagedRuntime(version: string | undefined, handlers: StreamHandlers): () => void {
  return openStream('/ansible/runtime/setup/stream', version ? { version } : {}, handlers)
}

// --- projects -----------------------------------------------------

export const listProjects = () =>
  backendGet<{ projects: Project[] | null }>('/ansible/projects').then((r) => arr(r.projects))

export const createProject = (body: { name: string; mode: 'new' | 'existing'; path?: string }) =>
  backendRequest<{ project: Project }>('POST', '/ansible/projects', body).then((r) => r.project)

export const deleteProject = (id: string) =>
  backendRequest<unknown>('DELETE', `/ansible/projects/${id}`)

export const projectTree = (id: string) =>
  backendGet<{ tree: ProjectTree }>(`/ansible/projects/${id}/tree`).then((r) => r.tree)

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
