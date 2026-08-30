/**
 * `IPromptRepository` on top of the general `IStoragePort` — same
 * index-plus-entries scheme as `schemaRepository.ts`. See
 * PROMPT_MODULE_PLAN.md §4.1.
 *
 *   prompt_index          → { folders: Folder[], promptIds: string[] }
 *   prompt_<id>           → one Prompt (full versions[] + draft)
 *   prompt_user_templates → SeedTemplate[]
 *
 * `savePrompt` / `deletePrompt` keep `prompt_index.promptIds` and the
 * per-prompt entries in sync. Works unchanged on web (localStorage) and
 * desktop (Tauri fs) via whichever `IStoragePort` `createStoragePort()` picks.
 */
import type { IStoragePort } from '@/core/ports/IStoragePort'
import type { IPromptRepository } from '@/core/prompt/ports/IPromptRepository'
import type { Folder, Prompt } from '@/core/prompt/promptModel'
import type { SeedTemplate } from '@/core/prompt/templates/index'
import { createStoragePort } from './createStoragePort'

const INDEX_KEY = 'prompt_index'
const USER_TEMPLATES_KEY = 'prompt_user_templates'

function promptKey(id: string): string {
  return `prompt_${id}`
}

interface PromptIndex {
  folders: Folder[]
  promptIds: string[]
}

function parse<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export class PromptRepository implements IPromptRepository {
  private readonly storage: IStoragePort
  constructor(storage: IStoragePort) {
    this.storage = storage
  }

  private async readIndex(): Promise<PromptIndex> {
    const idx = parse<PromptIndex>(await this.storage.get(INDEX_KEY), { folders: [], promptIds: [] })
    return {
      folders: Array.isArray(idx.folders) ? idx.folders : [],
      promptIds: Array.isArray(idx.promptIds) ? idx.promptIds : [],
    }
  }

  private writeIndex(index: PromptIndex): Promise<void> {
    return this.storage.set(INDEX_KEY, JSON.stringify(index))
  }

  async loadLibrary(): Promise<{ folders: Folder[]; prompts: Prompt[] }> {
    const index = await this.readIndex()
    const prompts: Prompt[] = []
    for (const id of index.promptIds) {
      const p = parse<Prompt | null>(await this.storage.get(promptKey(id)), null)
      if (p && p.id) prompts.push(p)
    }
    return { folders: index.folders, prompts }
  }

  async savePrompt(prompt: Prompt): Promise<void> {
    const index = await this.readIndex()
    if (!index.promptIds.includes(prompt.id)) {
      index.promptIds.push(prompt.id)
      await this.writeIndex(index)
    }
    await this.storage.set(promptKey(prompt.id), JSON.stringify(prompt))
  }

  async deletePrompt(id: string): Promise<void> {
    const index = await this.readIndex()
    const next = index.promptIds.filter((pid) => pid !== id)
    if (next.length !== index.promptIds.length) {
      await this.writeIndex({ ...index, promptIds: next })
    }
    await this.storage.remove(promptKey(id))
  }

  async saveFolder(folder: Folder): Promise<void> {
    const index = await this.readIndex()
    const existing = index.folders.findIndex((f) => f.id === folder.id)
    if (existing >= 0) index.folders[existing] = folder
    else index.folders.push(folder)
    await this.writeIndex(index)
  }

  async deleteFolder(id: string, orphanTo: 'unfiled' | 'delete'): Promise<void> {
    const index = await this.readIndex()
    index.folders = index.folders.filter((f) => f.id !== id)

    if (orphanTo === 'delete') {
      const remaining: string[] = []
      for (const pid of index.promptIds) {
        const p = parse<Prompt | null>(await this.storage.get(promptKey(pid)), null)
        if (p && p.folderId === id) {
          await this.storage.remove(promptKey(pid))
        } else {
          remaining.push(pid)
        }
      }
      index.promptIds = remaining
    } else {
      for (const pid of index.promptIds) {
        const p = parse<Prompt | null>(await this.storage.get(promptKey(pid)), null)
        if (p && p.folderId === id) {
          await this.storage.set(promptKey(pid), JSON.stringify({ ...p, folderId: null }))
        }
      }
    }
    await this.writeIndex(index)
  }

  async listUserTemplates(): Promise<SeedTemplate[]> {
    return parse<SeedTemplate[]>(await this.storage.get(USER_TEMPLATES_KEY), [])
  }

  async saveUserTemplate(template: SeedTemplate): Promise<void> {
    const all = await this.listUserTemplates()
    const idx = all.findIndex((t) => t.id === template.id)
    if (idx >= 0) all[idx] = template
    else all.push(template)
    await this.storage.set(USER_TEMPLATES_KEY, JSON.stringify(all))
  }

  async deleteUserTemplate(id: string): Promise<void> {
    const all = await this.listUserTemplates()
    await this.storage.set(USER_TEMPLATES_KEY, JSON.stringify(all.filter((t) => t.id !== id)))
  }
}

let cached: PromptRepository | null = null
export function createPromptRepository(): IPromptRepository {
  if (!cached) cached = new PromptRepository(createStoragePort())
  return cached
}
