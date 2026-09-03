/**
 * Prompt Library — export / import for user-promoted templates. Pure logic,
 * no React. Mirrors `promptIo.ts` (which does the same for prompts).
 *
 * The portable shape drops internal ids — template + message ids are
 * regenerated on import, so an import never collides with existing data.
 * `variables` (including `kind` / `options` / etc.) rides along as JSON and is
 * re-sanitised on the way in.
 */
import { newId, sanitizeVariables, type Message, type Role } from './promptModel'
import type { SeedTemplate } from './templates/index'

export const TEMPLATE_EXPORT_FORMAT = 'infrakit-prompt-templates'
export const TEMPLATE_EXPORT_VERSION = 1

interface ExportedTemplateMessage {
  role: Role
  content: string
}
interface ExportedTemplate {
  name: string
  tags: string[]
  variables: Record<string, unknown>
  messages: ExportedTemplateMessage[]
}
export interface TemplateExport {
  format: typeof TEMPLATE_EXPORT_FORMAT
  v: typeof TEMPLATE_EXPORT_VERSION
  exportedAt: number
  templates: ExportedTemplate[]
}

/** Serialise one or more templates to JSON. */
export function exportTemplates(templates: SeedTemplate[]): string {
  const exp: TemplateExport = {
    format: TEMPLATE_EXPORT_FORMAT,
    v: TEMPLATE_EXPORT_VERSION,
    exportedAt: Date.now(),
    templates: templates.map((t) => ({
      name: t.name,
      tags: [...t.tags],
      variables: JSON.parse(JSON.stringify(t.variables ?? {})),
      messages: t.messages.map((m) => ({ role: m.role, content: m.content })),
    })),
  }
  return JSON.stringify(exp, null, 2)
}

function isRole(x: unknown): x is Role {
  return x === 'system' || x === 'user' || x === 'assistant'
}

/** Parse + validate an export blob. Throws `Error` with a readable message. */
export function parseTemplateExport(json: string): TemplateExport {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Not valid JSON.')
  }
  const e = parsed as Partial<TemplateExport>
  if (e?.format !== TEMPLATE_EXPORT_FORMAT) throw new Error('Not a Prompt template export file.')
  if (e.v !== TEMPLATE_EXPORT_VERSION) throw new Error(`Unsupported export version: ${String(e.v)}.`)
  if (!Array.isArray(e.templates) || e.templates.length === 0) {
    throw new Error('Export contains no templates.')
  }
  for (const t of e.templates) {
    if (typeof t?.name !== 'string' || !Array.isArray(t.messages) || t.messages.length === 0) {
      throw new Error('Malformed template entry.')
    }
    for (const m of t.messages) {
      const mm = m as ExportedTemplateMessage
      if (!isRole(mm?.role) || typeof mm?.content !== 'string') {
        throw new Error('Malformed message in a template.')
      }
    }
  }
  return e as TemplateExport
}

const withIds = (msgs: ExportedTemplateMessage[]): Message[] =>
  msgs.map((m) => ({ id: newId('msg'), role: m.role, content: m.content }))

/**
 * Turn a parsed export into real `SeedTemplate` entities with fresh ids.
 * Names that collide with an existing user template get " (imported)" appended.
 */
export function materializeTemplateImport(
  exp: TemplateExport,
  existingNames: string[],
): SeedTemplate[] {
  const taken = new Set(existingNames)
  return exp.templates.map((t) => {
    let name = t.name
    if (taken.has(name)) name = `${name} (imported)`
    taken.add(name)
    return {
      id: newId('tmpl'),
      name,
      tags: Array.isArray(t.tags) ? t.tags.filter((x): x is string => typeof x === 'string') : [],
      variables: sanitizeVariables(t.variables),
      messages: withIds(t.messages),
      userDefined: true,
    }
  })
}
