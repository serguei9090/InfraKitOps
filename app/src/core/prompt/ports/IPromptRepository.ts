/**
 * Outbound port: persistence for the Prompt Library (folders, prompts, and
 * user-promoted templates). Implemented on top of the general `IStoragePort`
 * — see `adapters/storage/promptRepository.ts`. Mirrors `ISchemaRepository`.
 */
import type { Folder, Prompt } from '../promptModel'
import type { SeedTemplate } from '../templates/index'

export interface IPromptRepository {
  /** Everything needed to render the workspace, in one call. */
  loadLibrary(): Promise<{ folders: Folder[]; prompts: Prompt[] }>

  /** Insert or replace one prompt (keeps the index in sync). */
  savePrompt(prompt: Prompt): Promise<void>
  deletePrompt(id: string): Promise<void>

  saveFolder(folder: Folder): Promise<void>
  /** `orphanTo` decides what happens to prompts in a deleted folder. */
  deleteFolder(id: string, orphanTo: 'unfiled' | 'delete'): Promise<void>

  listUserTemplates(): Promise<SeedTemplate[]>
  saveUserTemplate(template: SeedTemplate): Promise<void>
  deleteUserTemplate(id: string): Promise<void>
}
