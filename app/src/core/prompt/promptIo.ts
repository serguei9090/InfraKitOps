/**
 * Prompt Library — export / import. Pure logic, no React.
 * See PROMPT_MODULE_PLAN.md §5 (P4).
 *
 * The portable shape drops internal ids (prompt/folder/message) — folder
 * references are carried as export-local ids and remapped on import; message
 * ids are regenerated. So an import never collides with existing data.
 */
import {
  cloneMessages,
  newFolder,
  newId,
  sanitizeVariables,
  type Folder,
  type Message,
  type Prompt,
  type PromptVersion,
  type Role,
  type VariableMeta,
} from './promptModel'

export const EXPORT_FORMAT = 'infrakit-prompt-library'
export const EXPORT_VERSION = 1

interface ExportedMessage {
  role: Role
  content: string
}
interface ExportedVersion {
  version: number
  createdAt: number
  messages: ExportedMessage[]
  note?: string
  pinned?: boolean
}
interface ExportedPrompt {
  name: string
  folderRef: string | null
  tags: string[]
  variables: Record<string, VariableMeta>
  versions: ExportedVersion[]
  draft: ExportedMessage[] | null
}
export interface PromptExport {
  format: typeof EXPORT_FORMAT
  v: typeof EXPORT_VERSION
  exportedAt: number
  folders: { ref: string; name: string }[]
  prompts: ExportedPrompt[]
}

const stripMessages = (msgs: Message[]): ExportedMessage[] =>
  msgs.map((m) => ({ role: m.role, content: m.content }))

const stripVersion = (v: PromptVersion): ExportedVersion => ({
  version: v.version,
  createdAt: v.createdAt,
  messages: stripMessages(v.messages),
  ...(v.note ? { note: v.note } : {}),
  ...(v.pinned ? { pinned: true } : {}),
})

/** Serialise one or more prompts (+ the folders they reference) to JSON. */
export function exportPrompts(prompts: Prompt[], folders: Folder[]): string {
  const usedFolderIds = new Set(prompts.map((p) => p.folderId).filter((x): x is string => x != null))
  const exp: PromptExport = {
    format: EXPORT_FORMAT,
    v: EXPORT_VERSION,
    exportedAt: Date.now(),
    folders: folders
      .filter((f) => usedFolderIds.has(f.id))
      .map((f) => ({ ref: f.id, name: f.name })),
    prompts: prompts.map((p) => ({
      name: p.name,
      folderRef: p.folderId,
      tags: [...p.tags],
      variables: JSON.parse(JSON.stringify(p.variables)),
      versions: p.versions.map(stripVersion),
      draft: p.draft ? stripMessages(p.draft) : null,
    })),
  }
  return JSON.stringify(exp, null, 2)
}

function isMessage(x: unknown): x is ExportedMessage {
  return (
    typeof x === 'object' &&
    x != null &&
    ['system', 'user', 'assistant'].includes((x as ExportedMessage).role) &&
    typeof (x as ExportedMessage).content === 'string'
  )
}

/** Parse + validate an export blob. Throws `Error` with a readable message. */
export function parsePromptExport(json: string): PromptExport {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Not valid JSON.')
  }
  const e = parsed as Partial<PromptExport>
  if (e?.format !== EXPORT_FORMAT) throw new Error('Not a Prompt Library export file.')
  if (e.v !== EXPORT_VERSION) throw new Error(`Unsupported export version: ${String(e.v)}.`)
  if (!Array.isArray(e.prompts) || e.prompts.length === 0) throw new Error('Export contains no prompts.')
  for (const p of e.prompts) {
    if (typeof p?.name !== 'string' || !Array.isArray(p.versions)) throw new Error('Malformed prompt entry.')
    for (const v of p.versions) {
      if (!Array.isArray(v.messages) || !v.messages.every(isMessage)) throw new Error('Malformed message in a version.')
    }
    if (p.draft != null && !(Array.isArray(p.draft) && p.draft.every(isMessage))) {
      throw new Error('Malformed draft messages.')
    }
  }
  return e as PromptExport
}

const withIds = (msgs: ExportedMessage[]): Message[] =>
  cloneMessages(msgs.map((m) => ({ id: 'x', role: m.role, content: m.content })))

/**
 * Turn a parsed export into real `Folder` / `Prompt` entities with fresh ids.
 * Folders are matched to existing ones by name (case-insensitive) and only
 * created when absent. Prompt names that collide with an existing prompt get
 * " (imported)" appended.
 */
export function materializeImport(
  exp: PromptExport,
  existing: { folders: Folder[]; promptNames: string[] },
): { folders: Folder[]; prompts: Prompt[] } {
  const existingByName = new Map(existing.folders.map((f) => [f.name.toLowerCase(), f]))
  const newFolders: Folder[] = []
  const refToId = new Map<string, string>()

  for (const f of exp.folders) {
    const hit = existingByName.get(f.name.toLowerCase())
    if (hit) {
      refToId.set(f.ref, hit.id)
    } else {
      const created = newFolder(f.name)
      newFolders.push(created)
      existingByName.set(f.name.toLowerCase(), created)
      refToId.set(f.ref, created.id)
    }
  }

  const takenNames = new Set(existing.promptNames)
  const now = Date.now()
  const prompts: Prompt[] = exp.prompts.map((p, i) => {
    let name = p.name
    if (takenNames.has(name)) name = `${name} (imported)`
    takenNames.add(name)
    return {
      id: newId('prompt'),
      name,
      folderId: p.folderRef ? (refToId.get(p.folderRef) ?? null) : null,
      tags: [...p.tags],
      order: now + i,
      variables: sanitizeVariables(p.variables),
      versions: p.versions.map((v) => ({
        version: v.version,
        createdAt: v.createdAt,
        messages: withIds(v.messages),
        ...(v.note ? { note: v.note } : {}),
        ...(v.pinned ? { pinned: true } : {}),
      })),
      draft: p.draft ? withIds(p.draft) : null,
      createdAt: now,
      updatedAt: now,
    }
  })

  return { folders: newFolders, prompts }
}
