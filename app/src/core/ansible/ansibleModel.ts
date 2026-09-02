/**
 * Ansible Manager module — framework-free domain types. Mirrors the Go
 * `internal/ansible` package. See ANSIBLE_MODULE_PLAN.md.
 */

export type RuntimeMode = 'auto' | 'system' | 'managed'

export interface AnsibleBin {
  path?: string
  found: boolean
  version?: string
}

export interface AnsibleCapabilities {
  runtime: RuntimeMode
  active: Record<string, AnsibleBin>
  system: Record<string, AnsibleBin>
  managed: Record<string, AnsibleBin>
  uv: AnsibleBin
  venvPath: string
  ready: boolean
  reason?: string
}

export interface AnsibleSettings {
  workspaceDir: string
  runtime: RuntimeMode
  defaultWorkspace: string
  capabilities: AnsibleCapabilities
}

export interface Project {
  id: string
  owner?: string
  name: string
  path: string
  source: string // "local" | "git" (AN5)
  published: boolean
  createdAt: number
}

export interface ProjectTree {
  playbooks: string[]
  roles: string[]
  collections: string[]
  inventories: string[]
  hasConfig: boolean
  hasReqs: boolean
}

export interface RunSpec {
  projectId: string
  playbook: string
  inventory?: string
  limit?: string
  tags?: string
  skipTags?: string
  extraVars?: string
  check?: boolean
  diff?: boolean
  become?: boolean
  verbosity?: number
  forks?: number
}

export type RunStatus = 'running' | 'ok' | 'failed' | 'unreachable' | 'cancelled'

export interface Run {
  id: number
  owner?: string
  projectId: string
  playbook: string
  status: RunStatus
  argv: string
  events?: string
  recap?: string
  triggeredBy: string
  startedAt: number
  finishedAt: number
}

/** Per-host outcome of a task, from the streaming callback plugin. */
export type HostState = 'ok' | 'changed' | 'failed' | 'skipped' | 'unreachable'

export interface TaskNode {
  uuid: string
  name: string
  action: string
  hosts: Record<string, { state: HostState; changed: boolean; diff?: unknown; msg?: string }>
}

export interface PlayNode {
  name: string
  hosts: string[]
  tasks: TaskNode[]
}

export interface RunRecap {
  hosts: Record<
    string,
    {
      ok: number
      changed: number
      failures: number
      unreachable: number
      skipped: number
      rescued: number
      ignored: number
    }
  >
}

/** The live tree the Run view renders, folded from `ansible-*` SSE events. */
export interface LiveRun {
  projectId: string
  runId: number | null
  status: 'starting' | 'running' | RunStatus | 'error'
  plays: PlayNode[]
  console: { stream: 'stdout' | 'stderr'; text: string }[]
  recap: RunRecap | null
  error?: string
  abort: () => void
}
