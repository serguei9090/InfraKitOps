import { describe, expect, it } from 'vitest'
import { exportPrompts, materializeImport, parsePromptExport } from './promptIo'
import { newFolder, newPrompt, type Prompt } from './promptModel'

function saved(name: string, folderId: string | null): Prompt {
  const p = newPrompt(name, folderId)
  return { ...p, versions: [{ version: 1, createdAt: 1000, messages: p.draft! }], draft: null }
}

describe('exportPrompts / parsePromptExport', () => {
  it('round-trips through JSON', () => {
    const f = newFolder('Infra')
    const p = saved('Test', f.id)
    const json = exportPrompts([p], [f])
    const parsed = parsePromptExport(json)
    expect(parsed.prompts).toHaveLength(1)
    expect(parsed.prompts[0].name).toBe('Test')
    expect(parsed.folders).toEqual([{ ref: f.id, name: 'Infra' }])
  })

  it('only includes referenced folders', () => {
    const used = newFolder('Used')
    const unused = newFolder('Unused')
    const json = exportPrompts([saved('P', used.id)], [used, unused])
    expect(parsePromptExport(json).folders.map((x) => x.name)).toEqual(['Used'])
  })

  it('rejects non-export JSON', () => {
    expect(() => parsePromptExport('{"foo":1}')).toThrow(/not a prompt library export/i)
    expect(() => parsePromptExport('not json')).toThrow(/valid json/i)
  })

  it('rejects a malformed message', () => {
    const bad = JSON.stringify({
      format: 'infrakit-prompt-library',
      v: 1,
      exportedAt: 0,
      folders: [],
      prompts: [{ name: 'x', folderRef: null, tags: [], variables: {}, draft: null, versions: [{ version: 1, createdAt: 0, messages: [{ role: 'bogus', content: 'x' }] }] }],
    })
    expect(() => parsePromptExport(bad)).toThrow(/malformed message/i)
  })
})

describe('materializeImport', () => {
  it('regenerates ids and reuses an existing folder by name', () => {
    const f = newFolder('Infra')
    const p = saved('Test', f.id)
    const exp = parsePromptExport(exportPrompts([p], [f]))

    const existingFolder = { ...newFolder('Infra') } // same name, different id
    const out = materializeImport(exp, { folders: [existingFolder], promptNames: [] })

    expect(out.folders).toHaveLength(0) // reused, not created
    expect(out.prompts[0].folderId).toBe(existingFolder.id)
    expect(out.prompts[0].id).not.toBe(p.id)
    const msgIds = out.prompts[0].versions[0].messages.map((m) => m.id)
    expect(new Set(msgIds).size).toBe(msgIds.length)
    expect(msgIds).not.toContain(p.versions[0].messages[0].id)
  })

  it('creates a missing folder and de-collides prompt names', () => {
    const f = newFolder('NewFolder')
    const exp = parsePromptExport(exportPrompts([saved('Dup', f.id)], [f]))
    const out = materializeImport(exp, { folders: [], promptNames: ['Dup'] })
    expect(out.folders.map((x) => x.name)).toEqual(['NewFolder'])
    expect(out.prompts[0].name).toBe('Dup (imported)')
  })
})
