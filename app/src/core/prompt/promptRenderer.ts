/**
 * Prompt Library — variable substitution + copy formats.
 * See PROMPT_MODULE_PLAN.md §1.3 / §3.4.
 */
import type { Message, Role } from './promptModel'

export type CopyFormat = 'text' | 'markdown' | 'messages-json' | 'system-user'

export const COPY_FORMATS: { value: CopyFormat; label: string }[] = [
  { value: 'text', label: 'Plain text, labeled' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'messages-json', label: 'Messages JSON' },
  { value: 'system-user', label: 'System + user' },
]

const VARIABLE_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

const ROLE_LABEL: Record<Role, string> = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
}

/** Substitute `{{VARS}}` in one string. Unknown / unfilled variables are left
 *  as the literal `{{NAME}}` (non-blocking — see `countUnfilled`). */
export function renderText(text: string, values: Record<string, string>): string {
  return text.replace(VARIABLE_RE, (whole, name: string) => {
    const v = values[name]
    return v != null && v !== '' ? v : whole
  })
}

/** One message's content with variables substituted. */
export function renderMessage(message: Message, values: Record<string, string>): string {
  return renderText(message.content, values)
}

/** How many distinct variables in `messages` have no non-empty value in `values`. */
export function countUnfilled(messages: Message[], values: Record<string, string>): number {
  const missing = new Set<string>()
  for (const m of messages) {
    for (const match of m.content.matchAll(VARIABLE_RE)) {
      const name = match[1]
      if (values[name] == null || values[name] === '') missing.add(name)
    }
  }
  return missing.size
}

/** Render the whole message list to a single string in the chosen format. */
export function renderAll(
  messages: Message[],
  values: Record<string, string>,
  format: CopyFormat,
): string {
  const rendered = messages.map((m) => ({ role: m.role, content: renderText(m.content, values) }))

  switch (format) {
    case 'messages-json':
      return JSON.stringify(rendered, null, 2)

    case 'system-user': {
      const systems = rendered.filter((m) => m.role === 'system').map((m) => m.content)
      const users = rendered.filter((m) => m.role === 'user').map((m) => m.content)
      return [...systems, ...users].filter((s) => s.length > 0).join('\n\n')
    }

    case 'markdown': {
      if (rendered.length === 1) return rendered[0].content
      return rendered.map((m) => `### ${ROLE_LABEL[m.role]}\n\n${m.content}`).join('\n\n')
    }

    case 'text':
    default: {
      if (rendered.length === 1) return rendered[0].content
      return rendered.map((m) => `${ROLE_LABEL[m.role]}:\n${m.content}`).join('\n\n')
    }
  }
}
