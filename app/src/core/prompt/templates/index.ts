/**
 * Prompt Library — shipped starter templates + the merge with user-promoted
 * ones. See PROMPT_MODULE_PLAN.md §1.6 / §3.6.
 */
import type { Message, VariableMeta } from '../promptModel'
import { IT_TROUBLESHOOTING_TEMPLATES } from './itTroubleshooting'

export interface SeedTemplate {
  id: string
  name: string
  tags: string[]
  messages: Message[]
  variables: Record<string, VariableMeta>
  /** Set on user-promoted templates so the gallery can offer "remove". */
  userDefined?: boolean
}

/** Tags the seed set uses — also feeds the tag-input autocomplete. */
export const TEMPLATE_TAGS: string[] = [
  'chat',
  'agent',
  'troubleshooting',
  'linux',
  'network',
  'security',
  'performance',
  'containers',
  'database',
  'observability',
  'incident',
  'review',
]

/** Shipped, read-only templates. */
export const TEMPLATE_PROMPTS: SeedTemplate[] = [...IT_TROUBLESHOOTING_TEMPLATES]

/** Seeds first, then the user's own, de-duplicated by id (user wins). */
export function mergeTemplates(userTemplates: SeedTemplate[]): SeedTemplate[] {
  const byId = new Map<string, SeedTemplate>()
  for (const t of TEMPLATE_PROMPTS) byId.set(t.id, t)
  for (const t of userTemplates) byId.set(t.id, { ...t, userDefined: true })
  return [...byId.values()]
}

/** Ordered, de-duplicated list of every tag used across a template list. */
export function templateTagList(templates: SeedTemplate[]): string[] {
  const seen: string[] = []
  for (const t of templates) {
    for (const tag of t.tags) if (!seen.includes(tag)) seen.push(tag)
  }
  return seen.sort()
}
