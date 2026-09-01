/**
 * Grouping + model resolution for grounding tasks — framework-free so both the
 * AI Hub "Tasks" view and the Settings "AI" section share one definition of
 * "which module does this task belong to" and "which model will it use".
 */
import type { LlmConnection, LlmTask } from './llmModel'

export interface TaskGroup {
  key: string
  label: string
  tasks: LlmTask[]
}

// Task-id prefix → owning module. A custom task whose prefix matches none of
// these lands in "Other".
const KNOWN: { prefix: string; label: string }[] = [
  { prefix: 'prompt.', label: 'Prompt Library' },
  { prefix: 'runbook.', label: 'Runbooks' },
  { prefix: 'command.', label: 'Shell & SSH' },
]

/** Bucket tasks by owning module, in a stable order, dropping empty groups. */
export function groupTasks(tasks: LlmTask[]): TaskGroup[] {
  const groups: TaskGroup[] = KNOWN.map((g) => ({ key: g.prefix, label: g.label, tasks: [] }))
  const other: TaskGroup = { key: '_other', label: 'Other / custom', tasks: [] }
  for (const t of tasks) {
    const g = groups.find((x) => t.id.startsWith(x.key))
    ;(g ?? other).tasks.push(t)
  }
  return [...groups.filter((g) => g.tasks.length > 0), ...(other.tasks.length > 0 ? [other] : [])]
}

export interface ResolvedTaskModel {
  /** model id the task will run on ("" if nothing is configured yet) */
  model: string
  /** connection name it will run against */
  connection: string
  /** "task override" if the task pins its own connection/model, else "global default" */
  scope: 'task override' | 'global default'
}

/**
 * What model/connection a task resolves to, mirroring `AiPanel`'s chain:
 * task-preferred → global default → first connection.
 */
export function resolveTaskModel(
  t: LlmTask,
  connections: LlmConnection[],
  settings: { defaultConnectionId?: string; defaultModel?: string },
): ResolvedTaskModel {
  const pinned = Boolean(t.preferredConnectionId || t.preferredModel)
  const conn =
    (t.preferredConnectionId && connections.find((c) => c.id === t.preferredConnectionId)) ||
    (settings.defaultConnectionId && connections.find((c) => c.id === settings.defaultConnectionId)) ||
    connections[0]
  const model =
    t.preferredModel || t.suggestedModel || conn?.defaultModel || settings.defaultModel || ''
  return {
    model,
    connection: conn?.name ?? (t.preferredConnectionId ? 'unknown connection' : 'no connection'),
    scope: pinned ? 'task override' : 'global default',
  }
}
