/**
 * Runbooks — `{{TOKEN}}` detection in step scripts. Matches the backend's
 * `varRe` (RUNBOOK_MODULE_PLAN.md §6): name is `[A-Za-z0-9_.:]+`, so it also
 * matches `secret:NAME` and `steps.1.stdout`.
 */
import type { RunbookSpec } from './runbookModel'

const TOKEN_RE = /\{\{\s*([A-Za-z0-9_.:]+)\s*\}\}/g

/** Every `{{TOKEN}}` in the text, first-appearance order, de-duplicated. */
export function extractTokens(text: string): string[] {
  const seen = new Set<string>()
  for (const m of text.matchAll(TOKEN_RE)) seen.add(m[1])
  return [...seen]
}

/** True for the built-in refs that are NOT user args. */
export function isBuiltinToken(token: string): boolean {
  return token.includes(':') || token.startsWith('steps.')
}

/** The user-facing arg names across every step (excludes `secret:` / `steps.`). */
export function specArgNames(spec: RunbookSpec): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const step of spec.steps) {
    for (const t of extractTokens(step.script)) {
      if (isBuiltinToken(t) || seen.has(t)) continue
      seen.add(t)
      out.push(t)
    }
  }
  return out
}

/** The `secret:NAME` refs used anywhere in the spec. */
export function specSecretRefs(spec: RunbookSpec): string[] {
  const seen = new Set<string>()
  for (const step of spec.steps) {
    for (const t of extractTokens(step.script)) {
      if (t.startsWith('secret:')) seen.add(t.slice('secret:'.length))
    }
  }
  return [...seen]
}
