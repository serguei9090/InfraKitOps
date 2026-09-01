/**
 * Server-side Prompt Library repo (USER_MANAGEMENT_PLAN U4). Only used in
 * multi-user mode — `createPromptRepository()` picks this over the local
 * `IStoragePort` repo when `authStore.mode === 'on'`.
 *
 * Prompts / folders / user-templates are opaque JSON blobs to the backend;
 * this adapter just ships the same `Prompt` / `Folder` / `SeedTemplate`
 * shapes the local repo persists.
 */
import { backendGet, backendRequest } from './backendClient'
import type { IPromptRepository } from '@/core/prompt/ports/IPromptRepository'
import type { Folder, Prompt } from '@/core/prompt/promptModel'
import type { SeedTemplate } from '@/core/prompt/templates/index'

const arr = <T,>(v: T[] | null | undefined): T[] => v ?? []

export class BackendPromptRepository implements IPromptRepository {
  async loadLibrary(): Promise<{ folders: Folder[]; prompts: Prompt[] }> {
    const r = await backendGet<{ folders: Folder[] | null; prompts: Prompt[] | null }>('/prompts/library')
    return { folders: arr(r.folders), prompts: arr(r.prompts) }
  }

  async savePrompt(prompt: Prompt): Promise<void> {
    await backendRequest('PUT', `/prompts/${prompt.id}`, prompt)
  }

  async deletePrompt(id: string): Promise<void> {
    await backendRequest('DELETE', `/prompts/${id}`)
  }

  async publishPrompt(id: string, published: boolean): Promise<void> {
    await backendRequest('POST', `/prompts/${id}/publish`, { published })
  }

  async saveFolder(folder: Folder): Promise<void> {
    await backendRequest('PUT', `/prompts/folders/${folder.id}`, folder)
  }

  async deleteFolder(id: string, orphanTo: 'unfiled' | 'delete'): Promise<void> {
    await backendRequest('DELETE', `/prompts/folders/${id}?orphan=${orphanTo === 'delete' ? 'delete' : 'unfiled'}`)
  }

  async listUserTemplates(): Promise<SeedTemplate[]> {
    const r = await backendGet<{ templates: SeedTemplate[] | null }>('/prompts/templates')
    return arr(r.templates)
  }

  async saveUserTemplate(template: SeedTemplate): Promise<void> {
    await backendRequest('PUT', `/prompts/templates/${template.id}`, template)
  }

  async deleteUserTemplate(id: string): Promise<void> {
    await backendRequest('DELETE', `/prompts/templates/${id}`)
  }
}
