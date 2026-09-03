/**
 * Prompt Library — core data model. Framework-free (no React imports), same
 * rule as the rest of `src/core/**`. See PROMPT_MODULE_PLAN.md §3.1.
 *
 * A "prompt" is an ordered list of role-tagged messages. It carries an
 * append-only version history plus a mutable `draft` (unsaved edits). In P1
 * only `draft` is used — versioning lands in P2 — but the shape is defined in
 * full now so P2 is additive.
 */

export type Role = 'system' | 'user' | 'assistant'

export const ROLES: readonly Role[] = ['system', 'user', 'assistant']

export interface Message {
  /** Stable across edits; regenerated on clone/import so ids never collide. */
  id: string
  role: Role
  content: string
}

/** How a `{{VARIABLE}}` renders in the Fill & Copy form. Absent === 'text'
 *  (a plain single-line input, the original behaviour). */
export type VariableKind = 'text' | 'textarea' | 'select' | 'boolean' | 'number'

export const VARIABLE_KINDS: readonly VariableKind[] = [
  'text',
  'textarea',
  'select',
  'boolean',
  'number',
]

/** One choice for a `kind: 'select'` variable. `value` is what gets substituted
 *  into the prompt; `label` is the picker text (falls back to `value`). */
export interface VariableOption {
  value: string
  label?: string
}

/** Optional, user-supplied metadata for a `{{VARIABLE}}`. Detection of which
 *  variables exist is always by scanning message bodies — this is extra info. */
export interface VariableMeta {
  description?: string
  defaultValue?: string
  /** Form control to render at fill time. Absent === 'text'. */
  kind?: VariableKind
  /** `kind: 'select'` — the choices, in display order. */
  options?: VariableOption[]
  /** `kind: 'select'` — also allow a free-text value outside `options`. */
  allowCustom?: boolean
  /** `kind: 'number'` — optional bounds passed straight to the input. */
  min?: number
  max?: number
  step?: number
  /** Block "Copy all" until this variable has a non-empty value. */
  required?: boolean
}

/** True when a `VariableMeta` carries nothing worth persisting — the store
 *  drops the key entirely in that case (keeps `prompt.variables` tidy). */
export function isVariableMetaEmpty(meta: VariableMeta): boolean {
  return (
    !meta.description &&
    !meta.defaultValue &&
    (meta.kind == null || meta.kind === 'text') &&
    (meta.options == null || meta.options.length === 0) &&
    !meta.allowCustom &&
    meta.min == null &&
    meta.max == null &&
    meta.step == null &&
    !meta.required
  )
}

/** Coerce untrusted JSON (import path) into a safe `VariableMeta`. Drops
 *  anything malformed rather than throwing — this metadata is advisory. */
export function sanitizeVariableMeta(raw: unknown): VariableMeta {
  const r = (raw ?? {}) as Record<string, unknown>
  const meta: VariableMeta = {}
  if (typeof r.description === 'string') meta.description = r.description
  if (typeof r.defaultValue === 'string') meta.defaultValue = r.defaultValue
  if (typeof r.kind === 'string' && (VARIABLE_KINDS as readonly string[]).includes(r.kind)) {
    meta.kind = r.kind as VariableKind
  }
  if (Array.isArray(r.options)) {
    const opts: VariableOption[] = []
    const seen = new Set<string>()
    for (const o of r.options) {
      const oo = (o ?? {}) as Record<string, unknown>
      if (typeof oo.value !== 'string' || seen.has(oo.value)) continue
      seen.add(oo.value)
      opts.push(typeof oo.label === 'string' ? { value: oo.value, label: oo.label } : { value: oo.value })
    }
    if (opts.length > 0) meta.options = opts
  }
  if (r.allowCustom === true) meta.allowCustom = true
  if (typeof r.min === 'number' && Number.isFinite(r.min)) meta.min = r.min
  if (typeof r.max === 'number' && Number.isFinite(r.max)) meta.max = r.max
  if (typeof r.step === 'number' && Number.isFinite(r.step)) meta.step = r.step
  if (r.required === true) meta.required = true
  return meta
}

/** Sanitise a whole `Record<name, VariableMeta>` map from untrusted JSON. */
export function sanitizeVariables(raw: unknown): Record<string, VariableMeta> {
  if (raw == null || typeof raw !== 'object') return {}
  const out: Record<string, VariableMeta> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    out[name] = sanitizeVariableMeta(value)
  }
  return out
}

export interface PromptVersion {
  /** 1-based, monotonic, never reused (even after a delete). */
  version: number
  /** unix ms UTC */
  createdAt: number
  /** FULL snapshot of the messages at save time — not a delta. */
  messages: Message[]
  note?: string
  /** Pinned versions (and the latest) can't be deleted. */
  pinned?: boolean
}

export interface Prompt {
  id: string
  name: string
  folderId: string | null
  tags: string[]
  /** Manual order within a folder (P4 drag). Defaults to `createdAt`. */
  order: number
  /** Metadata keyed by variable name. Kept even if a variable is removed. */
  variables: Record<string, VariableMeta>
  /** Append-only; may be spliced by an explicit per-version delete (P2). */
  versions: PromptVersion[]
  /** Unsaved edits. `null` when the prompt is clean (draft === latest). */
  draft: Message[] | null
  createdAt: number
  updatedAt: number
}

export interface Folder {
  id: string
  name: string
  /** Always `null` for now — one-level folders. Kept for a later nesting flip. */
  parentId: string | null
  order: number
}

export interface PromptLibrary {
  folders: Folder[]
  prompts: Prompt[]
}

// --- helpers -----------------------------------------------------------------

/** The newest saved version, or `null` for a never-saved prompt. */
export function latestVersion(p: Prompt): PromptVersion | null {
  if (p.versions.length === 0) return null
  return p.versions.reduce((a, b) => (b.version > a.version ? b : a))
}

/** The messages currently being edited/shown: the draft if dirty, else the
 *  latest saved version, else an empty list (brand-new prompt). */
export function currentMessages(p: Prompt): Message[] {
  if (p.draft != null) return p.draft
  return latestVersion(p)?.messages ?? []
}

export function isDirty(p: Prompt): boolean {
  return p.draft != null
}

/** Structural equality of two message lists (id + role + content, in order). */
export function messagesEqual(a: Message[], b: Message[]): boolean {
  if (a.length !== b.length) return false
  return a.every((m, i) => m.id === b[i].id && m.role === b[i].role && m.content === b[i].content)
}

/** Messages of a specific saved version, or `null` if there is no such version. */
export function versionMessages(p: Prompt, version: number): Message[] | null {
  return p.versions.find((v) => v.version === version)?.messages ?? null
}

/** The next version number a Save would produce. */
export function nextVersionNumber(p: Prompt): number {
  return p.versions.reduce((max, v) => Math.max(max, v.version), 0) + 1
}

let idCounter = 0
/** Compact unique id — `crypto.randomUUID` when available, else a fallback.
 *  Kept here (not the uuid dep) so `src/core` has zero extra dependencies. */
export function newId(prefix = 'id'): string {
  const rand =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}_${rand}`
}

export function emptyMessage(role: Role): Message {
  return { id: newId('msg'), role, content: '' }
}

/** A fresh prompt: one empty system + one empty user, no versions (draft-only
 *  until the first Save). */
export function newPrompt(name: string, folderId: string | null): Prompt {
  const now = Date.now()
  return {
    id: newId('prompt'),
    name,
    folderId,
    tags: [],
    order: now,
    variables: {},
    versions: [],
    draft: [emptyMessage('system'), emptyMessage('user')],
    createdAt: now,
    updatedAt: now,
  }
}

export function newFolder(name: string): Folder {
  return { id: newId('folder'), name, parentId: null, order: Date.now() }
}

/** Deep-clone a message list with fresh ids (clone-from-template, import). */
export function cloneMessages(messages: Message[]): Message[] {
  return messages.map((m) => ({ id: newId('msg'), role: m.role, content: m.content }))
}
