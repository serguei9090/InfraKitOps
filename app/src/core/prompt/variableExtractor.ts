/**
 * Prompt Library — `{{VARIABLE}}` detection. See PROMPT_MODULE_PLAN.md §1.2 / §3.2.
 *
 * Syntax: `{{ NAME }}` — mustache-style, optional surrounding whitespace,
 * name is `[A-Za-z0-9_]+`. Anything else between braces is not a variable.
 */
import type { Message } from './promptModel'

/** Global so `.matchAll` walks every occurrence in a body. */
const VARIABLE_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

/** All variable names in one string, in first-appearance order, de-duplicated. */
export function extractVariablesFromText(text: string): string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(VARIABLE_RE)) {
    seen.add(match[1])
  }
  return [...seen]
}

/** All variable names across every message body, first-appearance order,
 *  de-duplicated. This is the source of truth for which variables a prompt has. */
export function extractVariables(messages: Message[]): string[] {
  const seen = new Set<string>()
  for (const m of messages) {
    for (const match of m.content.matchAll(VARIABLE_RE)) {
      seen.add(match[1])
    }
  }
  return [...seen]
}

/** True when `name` is a syntactically valid variable name. */
export function isValidVariableName(name: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(name)
}
