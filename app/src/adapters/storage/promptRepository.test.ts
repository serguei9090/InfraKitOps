import { beforeEach, describe, expect, it } from 'vitest'
import type { IStoragePort } from '@/core/ports/IStoragePort'
import { newFolder, newPrompt, type Prompt } from '@/core/prompt/promptModel'
import { PromptRepository } from './promptRepository'

class InMemoryStorage implements IStoragePort {
  private map = new Map<string, string>()
  get(key: string) {
    return Promise.resolve(this.map.has(key) ? this.map.get(key)! : null)
  }
  set(key: string, value: string) {
    this.map.set(key, value)
    return Promise.resolve()
  }
  remove(key: string) {
    this.map.delete(key)
    return Promise.resolve()
  }
  keys() {
    return Promise.resolve([...this.map.keys()])
  }
}

let storage: InMemoryStorage
let repo: PromptRepository

beforeEach(() => {
  storage = new InMemoryStorage()
  repo = new PromptRepository(storage)
})

describe('PromptRepository', () => {
  it('round-trips a prompt and keeps the index in sync', async () => {
    const p = newPrompt('Test', null)
    await repo.savePrompt(p)

    const lib = await repo.loadLibrary()
    expect(lib.prompts).toHaveLength(1)
    expect(lib.prompts[0].id).toBe(p.id)
    expect(lib.prompts[0].draft).toEqual(p.draft)
  })

  it('does not duplicate the index entry on re-save', async () => {
    const p = newPrompt('Test', null)
    await repo.savePrompt(p)
    await repo.savePrompt({ ...p, name: 'Renamed' })

    const lib = await repo.loadLibrary()
    expect(lib.prompts).toHaveLength(1)
    expect(lib.prompts[0].name).toBe('Renamed')
  })

  it('deletePrompt removes the entry and the index id', async () => {
    const p = newPrompt('Test', null)
    await repo.savePrompt(p)
    await repo.deletePrompt(p.id)

    expect(await storage.get(`prompt_${p.id}`)).toBeNull()
    const lib = await repo.loadLibrary()
    expect(lib.prompts).toHaveLength(0)
  })

  it('deleteFolder "unfiled" moves its prompts to folderId null', async () => {
    const f = newFolder('Infra')
    await repo.saveFolder(f)
    const p: Prompt = { ...newPrompt('P', f.id), folderId: f.id }
    await repo.savePrompt(p)

    await repo.deleteFolder(f.id, 'unfiled')

    const lib = await repo.loadLibrary()
    expect(lib.folders).toHaveLength(0)
    expect(lib.prompts).toHaveLength(1)
    expect(lib.prompts[0].folderId).toBeNull()
  })

  it('deleteFolder "delete" removes its prompts', async () => {
    const f = newFolder('Infra')
    await repo.saveFolder(f)
    const kept = newPrompt('kept', null)
    const gone: Prompt = { ...newPrompt('gone', f.id), folderId: f.id }
    await repo.savePrompt(kept)
    await repo.savePrompt(gone)

    await repo.deleteFolder(f.id, 'delete')

    const lib = await repo.loadLibrary()
    expect(lib.prompts.map((p) => p.name)).toEqual(['kept'])
  })

  it('user templates round-trip and de-dupe by id', async () => {
    await repo.saveUserTemplate({ id: 't1', name: 'A', tags: [], messages: [], variables: {} })
    await repo.saveUserTemplate({ id: 't1', name: 'A2', tags: [], messages: [], variables: {} })
    const list = await repo.listUserTemplates()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('A2')
  })
})
