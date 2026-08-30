import { describe, expect, it } from 'vitest'
import { extractVariables } from '../variableExtractor'
import { mergeTemplates, TEMPLATE_PROMPTS, templateTagList } from './index'

describe('seed templates', () => {
  it('ships the 10 IT-troubleshooting seeds', () => {
    expect(TEMPLATE_PROMPTS).toHaveLength(10)
  })

  it('every seed is well-formed', () => {
    const ids = new Set<string>()
    for (const t of TEMPLATE_PROMPTS) {
      expect(t.id, 'id present').toBeTruthy()
      expect(ids.has(t.id), `id ${t.id} unique`).toBe(false)
      ids.add(t.id)
      expect(t.name.trim().length, `${t.id} has a name`).toBeGreaterThan(0)
      expect(t.messages.length, `${t.id} has messages`).toBeGreaterThan(0)
      expect(t.tags.length, `${t.id} has tags`).toBeGreaterThan(0)
      // message ids unique within the template
      const msgIds = new Set(t.messages.map((m) => m.id))
      expect(msgIds.size, `${t.id} message ids unique`).toBe(t.messages.length)
      for (const m of t.messages) {
        expect(['system', 'user', 'assistant']).toContain(m.role)
      }
    }
  })

  it('every {{VARIABLE}} used has a metadata entry', () => {
    for (const t of TEMPLATE_PROMPTS) {
      const used = extractVariables(t.messages)
      for (const name of used) {
        expect(t.variables[name], `${t.id} declares {{${name}}}`).toBeDefined()
      }
    }
  })

  it('agent seeds carry a user → assistant few-shot pair', () => {
    for (const t of TEMPLATE_PROMPTS.filter((x) => x.tags.includes('agent'))) {
      expect(t.messages.some((m) => m.role === 'assistant'), `${t.id} has an assistant example`).toBe(true)
    }
  })

  it('mergeTemplates: user templates override seeds by id, seeds otherwise intact', () => {
    const merged = mergeTemplates([
      { id: 'seed-disk-full', name: 'My disk-full', tags: ['chat'], messages: [], variables: {} },
      { id: 'my-own', name: 'Mine', tags: ['x'], messages: [], variables: {} },
    ])
    expect(merged).toHaveLength(11)
    expect(merged.find((t) => t.id === 'seed-disk-full')?.name).toBe('My disk-full')
    expect(merged.find((t) => t.id === 'seed-disk-full')?.userDefined).toBe(true)
    expect(merged.find((t) => t.id === 'my-own')?.userDefined).toBe(true)
  })

  it('templateTagList is sorted + deduped', () => {
    const tags = templateTagList(TEMPLATE_PROMPTS)
    expect(tags).toEqual([...tags].sort())
    expect(new Set(tags).size).toBe(tags.length)
    expect(tags).toContain('agent')
    expect(tags).toContain('chat')
  })
})
