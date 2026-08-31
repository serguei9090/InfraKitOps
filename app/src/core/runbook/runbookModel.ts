/**
 * Runbooks module — core model, mirrors backend/internal/orchestrator/model.go.
 * Framework-free (no React), same rule as the rest of `src/core/**`.
 * See RUNBOOK_MODULE_PLAN.md §4.
 */

export type ExecutorKind = 'powershell' | 'cmd' | 'bash' | 'ssh' | 'http'
// (R4 adds 'python'. No 'ansible' / 'kubectl' — those are plain commands.)

export const EXECUTOR_KINDS: readonly ExecutorKind[] = ['powershell', 'cmd', 'bash', 'ssh', 'http']

export const EXECUTOR_LABEL: Record<ExecutorKind, string> = {
  powershell: 'PowerShell',
  cmd: 'CMD',
  bash: 'Bash / sh',
  ssh: 'SSH',
  http: 'HTTP / API',
}

export type ArgType = 'string' | 'number' | 'enum' | 'boolean' | 'secret' | 'node' | 'multiline'

export interface ArgSpec {
  name: string
  label?: string
  help?: string
  type: ArgType
  required: boolean
  default?: string
  enumValues?: string[]
  validationRegex?: string
  validationPreset?: string
  errorMessage?: string
}

export interface StepSpec {
  id: string
  name: string
  executor: ExecutorKind
  script: string
  timeoutSec?: number
  continueOnError: boolean
  runIf?: '' | 'always' | 'prev-success' | 'prev-failure'
  ssh?: {
    nodeId?: string
    inlineHost?: string
    user?: string
    authSecretId?: string
    sudo?: boolean
    jumpNodeId?: string
  }
  http?: {
    method: string
    url: string
    headers: { k: string; v: string }[]
    body?: string
    auth?: { kind: 'bearer' | 'basic'; secretId: string }
    expectStatus?: number[]
  }
}

export interface RunbookSpec {
  name: string
  description?: string
  detailedDescription?: string
  defaultTimeoutSec: number
  tags: string[]
  args: ArgSpec[]
  steps: StepSpec[]
}

export interface RunbookVersion {
  version: number
  createdAt: number
  note?: string
  pinned?: boolean
  spec: RunbookSpec
}

export interface Runbook {
  id: string
  slug: string
  published: boolean
  versions: RunbookVersion[]
  draft: RunbookSpec | null
  createdAt: number
  updatedAt: number
}

export interface SshNode {
  id: string
  name: string
  host: string
  port: number
  user: string
  authKind: 'password' | 'key' | 'agent'
  authSecretId?: string
  jumpNodeId?: string
  hostKeyFp?: string
  tags: string[]
  createdAt: number
}

export interface VaultSecretMeta {
  id: string
  name: string
  kind: 'password' | 'api-key' | 'token' | 'ssh-key' | 'kubeconfig' | 'certificate' | 'other'
  notes?: string
  updatedAt: number
}

export interface VaultStatus {
  initialised: boolean
  unlocked: boolean
  autoLockInSec: number
  autoLockTotalSec: number
  secretCount: number
}

// --- run / preview ---------------------------------------------------------

export type RunStatus = 'running' | 'ok' | 'failed' | 'partial'

export interface RunStep {
  index: number
  name: string
  executor: string
  target?: string
  commandRedacted: string
  stdout: string
  stderr: string
  exitCode: number
  status: RunStatus | 'skipped'
  startedAt: number
  finishedAt: number
}

export interface Run {
  id: number
  runbookId: string
  runbookVersion: number
  status: RunStatus
  dryRun: boolean
  triggeredBy: string
  startedAt: number
  finishedAt: number
  args: Record<string, string>
  steps: RunStep[]
}

export interface ValidationError {
  arg: string
  message: string
}

export interface DestructiveMatch {
  line: number
  text: string
  pattern: string
  note: string
}

export interface PreviewStep {
  index: number
  name: string
  executor: string
  command: string
}

export interface Preview {
  valid: boolean
  validation: ValidationError[]
  steps: PreviewStep[]
  destructive: DestructiveMatch[]
}

// --- helpers -------------------------------------------------------------

let idSeq = 0
export function newId(prefix = 'id'): string {
  const rand =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${(idSeq++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}_${rand}`
}

export function emptyStep(executor: ExecutorKind = 'bash'): StepSpec {
  return { id: newId('step'), name: '', executor, script: '', continueOnError: false, runIf: '' }
}

export function emptySpec(name = 'Untitled runbook'): RunbookSpec {
  return { name, defaultTimeoutSec: 60, tags: [], args: [], steps: [emptyStep()] }
}

/** The spec currently in effect: draft if present, else the latest version. */
export function currentSpec(rb: Runbook): RunbookSpec | null {
  if (rb.draft) return rb.draft
  const latest = latestVersion(rb)
  return latest ? latest.spec : null
}

export function latestVersion(rb: Runbook): RunbookVersion | null {
  if (rb.versions.length === 0) return null
  return rb.versions.reduce((a, b) => (b.version > a.version ? b : a))
}

export function nextVersionNumber(rb: Runbook): number {
  return rb.versions.reduce((m, v) => Math.max(m, v.version), 0) + 1
}

export function isDirty(rb: Runbook): boolean {
  return rb.draft != null
}
