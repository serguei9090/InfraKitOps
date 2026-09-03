/**
 * Prompt Library — workspace state (zustand). Persistence goes through
 * `IPromptRepository`, never straight to storage. Message edits autosave
 * debounced (~800 ms); structural changes (rename, tags, move, folder CRUD,
 * create, delete) persist immediately. See PROMPT_MODULE_PLAN.md §4.2.
 *
 * A prompt's working messages live in `draft`; `Save` (P2) appends an
 * immutable `PromptVersion` and clears the draft. Editing back to the latest
 * saved state clears the draft too (no phantom "unsaved" state).
 */
import { create } from 'zustand'
import { createPromptRepository } from '@/adapters/storage/promptRepository'
import {
  cloneMessages,
  currentMessages,
  isVariableMetaEmpty,
  latestVersion,
  messagesEqual,
  newFolder,
  newId,
  newPrompt,
  nextVersionNumber,
  type Folder,
  type Message,
  type Prompt,
  type VariableMeta,
} from '@/core/prompt/promptModel'
import { materializeImport, parsePromptExport } from '@/core/prompt/promptIo'
import {
  exportTemplates,
  materializeTemplateImport,
  parseTemplateExport,
} from '@/core/prompt/templateIo'
import type { SeedTemplate } from '@/core/prompt/templates/index'

const repo = createPromptRepository()
const AUTOSAVE_MS = 800

interface PromptLibraryState {
  folders: Folder[]
  prompts: Prompt[]
  /** User-promoted templates (the shipped seeds live in code). */
  userTemplates: SeedTemplate[]
  loaded: boolean
  selectedPromptId: string | null
  /** Which version the editor shows: `null` = the editable draft/latest, a
   *  number = that saved version, read-only. */
  viewingVersion: number | null
  /** Up to two version numbers picked for the Compare dialog. */
  compareSelection: number[]

  hydrate: () => Promise<void>

  selectPrompt: (id: string | null) => void
  setViewingVersion: (version: number | null) => void
  toggleCompareSelection: (version: number) => void
  clearCompareSelection: () => void

  createPrompt: (folderId: string | null, opts?: { fromTemplate?: SeedTemplate }) => Prompt
  duplicatePrompt: (id: string) => void
  deletePrompt: (id: string) => void
  renamePrompt: (id: string, name: string) => void
  setTags: (id: string, tags: string[]) => void
  moveToFolder: (id: string, folderId: string | null) => void
  /** Reassign `order` for the prompts of one folder (`null` = Unfiled). */
  reorderInFolder: (folderId: string | null, orderedIds: string[]) => void
  setVariableMeta: (id: string, name: string, meta: VariableMeta) => void

  /** Replace the working message list; autosaves debounced. */
  editMessages: (id: string, messages: Message[]) => void

  /** Append the current draft as a new immutable version, clear the draft. */
  saveVersion: (id: string, note?: string) => void
  /** Load a saved version's messages back into the draft for editing. */
  restoreVersion: (id: string, version: number) => void
  /** Delete one saved version — blocked on the latest and on pinned versions. */
  deleteVersion: (id: string, version: number) => void
  pinVersion: (id: string, version: number, pinned: boolean) => void
  /** Drop unsaved edits, reverting to the latest saved version. */
  discardDraft: (id: string) => void

  createFolder: (name: string) => Folder
  renameFolder: (id: string, name: string) => void
  deleteFolder: (id: string, orphanTo: 'unfiled' | 'delete') => void

  /** Copy a prompt's current messages into a reusable user template. */
  promoteToTemplate: (id: string) => void
  deleteUserTemplate: (templateId: string) => void
  /** Serialise user templates to a portable JSON blob (`templates` = all). */
  exportUserTemplates: (templates?: SeedTemplate[]) => string
  /** Import a template export blob. Returns how many landed; throws on a bad file. */
  importTemplatesFromJson: (json: string) => { added: number }

  /** Import a Prompt Library export blob. Returns how many prompts landed;
   *  throws `Error` with a readable message on a bad file. */
  importFromJson: (json: string) => { added: number }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

export const usePromptLibraryStore = create<PromptLibraryState>((set, get) => {
  /** Persist one prompt now, cancelling any pending debounce for it. */
  function persistNow(id: string) {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    const p = get().prompts.find((x) => x.id === id)
    if (p) void repo.savePrompt(p)
  }

  function schedulePersist(id: string) {
    const existing = timers.get(id)
    if (existing) clearTimeout(existing)
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        const p = get().prompts.find((x) => x.id === id)
        if (p) void repo.savePrompt(p)
      }, AUTOSAVE_MS),
    )
  }

  function patchPrompt(id: string, patch: Partial<Prompt>) {
    set((s) => ({
      prompts: s.prompts.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)),
    }))
  }

  return {
    folders: [],
    prompts: [],
    userTemplates: [],
    loaded: false,
    selectedPromptId: null,
    viewingVersion: null,
    compareSelection: [],

    async hydrate() {
      if (get().loaded) return
      const [{ folders, prompts }, userTemplates] = await Promise.all([
        repo.loadLibrary(),
        repo.listUserTemplates(),
      ])
      set({ folders, prompts, userTemplates, loaded: true })
    },

    selectPrompt: (id) =>
      set({ selectedPromptId: id, viewingVersion: null, compareSelection: [] }),

    setViewingVersion: (version) => set({ viewingVersion: version }),

    toggleCompareSelection: (version) =>
      set((s) => {
        if (s.compareSelection.includes(version)) {
          return { compareSelection: s.compareSelection.filter((v) => v !== version) }
        }
        // Keep at most two — drop the oldest pick.
        const next = [...s.compareSelection, version].slice(-2)
        return { compareSelection: next }
      }),

    clearCompareSelection: () => set({ compareSelection: [] }),

    createPrompt(folderId, opts) {
      const base = newPrompt(opts?.fromTemplate ? opts.fromTemplate.name : 'Untitled prompt', folderId)
      // From a template: land as v1 immediately (a real baseline to edit
      // against). From scratch: draft-only until the first Save.
      const prompt: Prompt = opts?.fromTemplate
        ? {
            ...base,
            tags: [...opts.fromTemplate.tags],
            variables: { ...opts.fromTemplate.variables },
            versions: [{ version: 1, createdAt: base.createdAt, messages: cloneMessages(opts.fromTemplate.messages) }],
            draft: null,
          }
        : base
      set((s) => ({ prompts: [...s.prompts, prompt], selectedPromptId: prompt.id, viewingVersion: null }))
      void repo.savePrompt(prompt)
      return prompt
    },

    duplicatePrompt(id) {
      const src = get().prompts.find((p) => p.id === id)
      if (!src) return
      const now = Date.now()
      const copy: Prompt = {
        ...src,
        id: newPrompt('', null).id,
        name: `${src.name} (copy)`,
        order: now,
        // A duplicate is a saved prompt from the start: current state = v1.
        versions: [{ version: 1, createdAt: now, messages: cloneMessages(currentMessages(src)) }],
        draft: null,
        createdAt: now,
        updatedAt: now,
      }
      set((s) => ({ prompts: [...s.prompts, copy], selectedPromptId: copy.id, viewingVersion: null }))
      void repo.savePrompt(copy)
    },

    deletePrompt(id) {
      const timer = timers.get(id)
      if (timer) {
        clearTimeout(timer)
        timers.delete(id)
      }
      set((s) => ({
        prompts: s.prompts.filter((p) => p.id !== id),
        selectedPromptId: s.selectedPromptId === id ? null : s.selectedPromptId,
      }))
      void repo.deletePrompt(id)
    },

    renamePrompt(id, name) {
      patchPrompt(id, { name })
      persistNow(id)
    },

    setTags(id, tags) {
      patchPrompt(id, { tags })
      persistNow(id)
    },

    moveToFolder(id, folderId) {
      patchPrompt(id, { folderId })
      persistNow(id)
    },

    reorderInFolder(folderId, orderedIds) {
      set((s) => ({
        prompts: s.prompts.map((p) => {
          const idx = orderedIds.indexOf(p.id)
          return idx >= 0 && p.folderId === folderId ? { ...p, order: idx } : p
        }),
      }))
      for (const pid of orderedIds) {
        const p = get().prompts.find((x) => x.id === pid)
        if (p) void repo.savePrompt(p)
      }
    },

    setVariableMeta(id, name, meta) {
      const p = get().prompts.find((x) => x.id === id)
      if (!p) return
      const next = { ...p.variables }
      if (isVariableMetaEmpty(meta)) delete next[name]
      else next[name] = meta
      patchPrompt(id, { variables: next })
      persistNow(id)
    },

    editMessages(id, messages) {
      const p = get().prompts.find((x) => x.id === id)
      if (!p) return
      const latest = latestVersion(p)
      // Editing back to exactly the latest saved state = clean, no draft.
      const draft = latest && messagesEqual(messages, latest.messages) ? null : messages
      patchPrompt(id, { draft })
      schedulePersist(id)
    },

    saveVersion(id, note) {
      const p = get().prompts.find((x) => x.id === id)
      if (!p || p.draft == null) return
      const version = {
        version: nextVersionNumber(p),
        createdAt: Date.now(),
        messages: p.draft,
        ...(note ? { note } : {}),
      }
      patchPrompt(id, { versions: [...p.versions, version], draft: null })
      set({ viewingVersion: null })
      persistNow(id)
    },

    restoreVersion(id, version) {
      const p = get().prompts.find((x) => x.id === id)
      const v = p?.versions.find((x) => x.version === version)
      if (!p || !v) return
      const copy = v.messages.map((mm) => ({ ...mm }))
      const latest = latestVersion(p)
      const draft = latest && messagesEqual(copy, latest.messages) ? null : copy
      patchPrompt(id, { draft })
      set({ viewingVersion: null })
      persistNow(id)
    },

    deleteVersion(id, version) {
      const p = get().prompts.find((x) => x.id === id)
      if (!p) return
      const v = p.versions.find((x) => x.version === version)
      const maxVersion = p.versions.reduce((mx, x) => Math.max(mx, x.version), 0)
      if (!v || v.pinned || v.version === maxVersion) return
      patchPrompt(id, { versions: p.versions.filter((x) => x.version !== version) })
      set((s) => ({
        viewingVersion: s.viewingVersion === version ? null : s.viewingVersion,
        compareSelection: s.compareSelection.filter((n) => n !== version),
      }))
      persistNow(id)
    },

    pinVersion(id, version, pinned) {
      const p = get().prompts.find((x) => x.id === id)
      if (!p) return
      patchPrompt(id, {
        versions: p.versions.map((x) => (x.version === version ? { ...x, pinned } : x)),
      })
      persistNow(id)
    },

    discardDraft(id) {
      const p = get().prompts.find((x) => x.id === id)
      if (!p || p.draft == null || p.versions.length === 0) return
      patchPrompt(id, { draft: null })
      set({ viewingVersion: null })
      persistNow(id)
    },

    createFolder(name) {
      const folder = newFolder(name)
      set((s) => ({ folders: [...s.folders, folder] }))
      void repo.saveFolder(folder)
      return folder
    },

    renameFolder(id, name) {
      set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) }))
      const f = get().folders.find((x) => x.id === id)
      if (f) void repo.saveFolder(f)
    },

    promoteToTemplate(id) {
      const p = get().prompts.find((x) => x.id === id)
      if (!p) return
      const template: SeedTemplate = {
        id: newId('tmpl'),
        name: p.name,
        tags: [...p.tags],
        variables: JSON.parse(JSON.stringify(p.variables)),
        messages: cloneMessages(currentMessages(p)),
        userDefined: true,
      }
      set((s) => ({ userTemplates: [...s.userTemplates, template] }))
      void repo.saveUserTemplate(template)
    },

    deleteUserTemplate(templateId) {
      set((s) => ({ userTemplates: s.userTemplates.filter((t) => t.id !== templateId) }))
      void repo.deleteUserTemplate(templateId)
    },

    exportUserTemplates(templates) {
      return exportTemplates(templates ?? get().userTemplates)
    },

    importTemplatesFromJson(json) {
      const exp = parseTemplateExport(json)
      const added = materializeTemplateImport(
        exp,
        get().userTemplates.map((t) => t.name),
      )
      set((s) => ({ userTemplates: [...s.userTemplates, ...added] }))
      for (const t of added) void repo.saveUserTemplate(t)
      return { added: added.length }
    },

    importFromJson(json) {
      const exp = parsePromptExport(json)
      const { folders: newFolders, prompts: newPrompts } = materializeImport(exp, {
        folders: get().folders,
        promptNames: get().prompts.map((p) => p.name),
      })
      set((s) => ({
        folders: [...s.folders, ...newFolders],
        prompts: [...s.prompts, ...newPrompts],
      }))
      for (const f of newFolders) void repo.saveFolder(f)
      for (const p of newPrompts) void repo.savePrompt(p)
      return { added: newPrompts.length }
    },

    deleteFolder(id, orphanTo) {
      const orphaned = get().prompts.filter((p) => p.folderId === id)
      set((s) => ({
        folders: s.folders.filter((f) => f.id !== id),
        prompts:
          orphanTo === 'delete'
            ? s.prompts.filter((p) => p.folderId !== id)
            : s.prompts.map((p) => (p.folderId === id ? { ...p, folderId: null } : p)),
        selectedPromptId:
          orphanTo === 'delete' &&
          s.prompts.find((p) => p.id === s.selectedPromptId)?.folderId === id
            ? null
            : s.selectedPromptId,
      }))
      void repo.deleteFolder(id, orphanTo)
      // The server-side repo can't re-parent blobs itself — persist the
      // survivors explicitly (a redundant no-op for the local repo).
      if (orphanTo === 'unfiled') {
        for (const p of orphaned) void repo.savePrompt({ ...p, folderId: null })
      }
    },
  }
})
