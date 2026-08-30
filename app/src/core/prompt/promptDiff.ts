/**
 * Prompt Library — version-to-version diff. Pure logic, no React.
 * See PROMPT_MODULE_PLAN.md §3.3.
 *
 * Messages are aligned by `Message.id` (stable across edits within the app).
 * When the two sides share no ids at all — e.g. an imported prompt whose ids
 * were regenerated — it falls back to positional alignment.
 */
import { diffWordsWithSpace, type Change } from 'diff'
import type { Message, Role } from './promptModel'

export type MessageDiffKind = 'unchanged' | 'added' | 'removed' | 'changed'

export interface MessageDiff {
  kind: MessageDiffKind
  /** `b`'s role, except for `removed` where only `a` has the message. */
  role: Role
  /** Present for `removed` and `changed`. */
  before?: string
  /** Present for `added` and `changed`. */
  after?: string
  /** Word-level change list, only for `changed`. */
  wordDiff?: Change[]
  /** Also flagged on `changed` when just the role moved. */
  roleChanged?: boolean
}

function classify(a: Message | undefined, b: Message | undefined): MessageDiff | null {
  if (a && b) {
    if (a.content === b.content && a.role === b.role) {
      return { kind: 'unchanged', role: b.role, after: b.content }
    }
    return {
      kind: 'changed',
      role: b.role,
      before: a.content,
      after: b.content,
      wordDiff: diffWordsWithSpace(a.content, b.content),
      roleChanged: a.role !== b.role,
    }
  }
  if (b) return { kind: 'added', role: b.role, after: b.content }
  if (a) return { kind: 'removed', role: a.role, before: a.content }
  return null
}

export function diffVersions(a: Message[], b: Message[]): MessageDiff[] {
  const bIds = new Set(b.map((m) => m.id))
  const shareIds = a.some((m) => bIds.has(m.id))

  if (!shareIds) {
    // Positional alignment.
    const out: MessageDiff[] = []
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = classify(a[i], b[i])
      if (d) out.push(d)
    }
    return out
  }

  const aById = new Map(a.map((m) => [m.id, m]))
  const out: MessageDiff[] = []

  // Follow b's order for survivors / additions / changes.
  for (const bm of b) {
    const d = classify(aById.get(bm.id), bm)
    if (d) out.push(d)
  }
  // Then the messages that only existed in a, in a's order.
  for (const am of a) {
    if (!bIds.has(am.id)) {
      const d = classify(am, undefined)
      if (d) out.push(d)
    }
  }
  return out
}

/** Headline counts for a compare header. */
export function diffSummary(diffs: MessageDiff[]): { added: number; removed: number; changed: number } {
  return {
    added: diffs.filter((d) => d.kind === 'added').length,
    removed: diffs.filter((d) => d.kind === 'removed').length,
    changed: diffs.filter((d) => d.kind === 'changed').length,
  }
}
