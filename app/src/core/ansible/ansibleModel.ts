/**
 * Ansible Manager module — framework-free domain types. Mirrors the Go
 * `internal/ansible` package. See ANSIBLE_MODULE_PLAN.md.
 */

export type RuntimeMode = 'auto' | 'system' | 'managed' | 'container' | 'wsl' | 'remote'

export interface RunnerStatus {
  mode: string
  ready: boolean
  reason?: string
  ansibleVersion?: string
  // container
  engine?: string // "docker" | "podman"
  engineVersion?: string
  daemonRunning?: boolean
  image?: string
  imageBuilt?: boolean
  // wsl
  wslInstalled?: boolean
  distro?: string
  distros?: string[]
  onlineDistros?: string[]
  distroReady?: boolean
  // remote
  nodeId?: string
  nodeName?: string
  remote?: string // user@host
}

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
  containerImage: string
  controlNodePipPackages: string
  controlNodeCollections: string
  wslDistro: string
  wslSource: string
  remoteNodeId: string
  remoteWorkdir: string
  remoteProjectPath: string
  os: string // 'windows' | 'linux' | 'darwin' | …
  install: Record<string, string> // tool → install-docs URL
  runners: Record<string, RunnerStatus>
  capabilities: AnsibleCapabilities
}

export interface GitConfig {
  url: string
  ref?: string
  secret?: string
  lastSync?: number
}

export interface Project {
  id: string
  owner?: string
  name: string
  path: string
  source: string // "local" | "git"
  git?: GitConfig
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

/** A saved run configuration. Running a Job produces a Run. */
export interface Job {
  id: string
  owner?: string
  projectId: string
  name: string
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
  surveySchema?: string
  requiresApproval?: boolean
  published: boolean
  createdAt: number
}

export interface Schedule {
  id: string
  owner?: string
  jobId: string
  name: string
  cron: string
  enabled: boolean
  nextRunAt: number
  lastRunAt: number
  lastStatus?: string
  lastRunId?: number
  lastError?: string
  createdAt: number
}

export interface InventoryResult {
  graph: string
  groups: Record<string, string[]>
  hosts: Record<string, Record<string, unknown>>
  source: string
}

export type RunStatus = 'running' | 'ok' | 'failed' | 'unreachable' | 'cancelled' | 'awaiting_approval'

export interface Run {
  id: number
  owner?: string
  projectId: string
  jobId?: string
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
