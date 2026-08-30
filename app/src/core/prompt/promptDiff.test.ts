import { describe, expect, it } from 'vitest'
import { diffSummary, diffVersions } from './promptDiff'
import type { Message } from './promptModel'

const m = (id: string, role: Message['role'], content: string): Message => ({ id, role, content })

describe('diffVersions (id-aligned)', () => {
  it('marks identical messages unchanged', () => {
    const a = [m('1', 'system', 'x'), m('2', 'user', 'y')]
    const d = diffVersions(a, a)
    expect(d.map((x) => x.kind)).toEqual(['unchanged', 'unchanged'])
  })

  it('detects a changed body with a word-level diff', () => {
    const a = [m('1', 'user', 'fix nginx now')]
    const b = [m('1', 'user', 'fix apache now')]
    const [d] = diffVersions(a, b)
    expect(d.kind).toBe('changed')
    expect(d.before).toBe('fix nginx now')
    expect(d.after).toBe('fix apache now')
    expect(d.wordDiff?.some((c) => c.added)).toBe(true)
    expect(d.wordDiff?.some((c) => c.removed)).toBe(true)
  })

  it('detects added and removed messages', () => {
    const a = [m('1', 'system', 's'), m('2', 'user', 'u')]
    const b = [m('1', 'system', 's'), m('3', 'assistant', 'a')]
    const d = diffVersions(a, b)
    expect(d.find((x) => x.kind === 'added')?.role).toBe('assistant')
    expect(d.find((x) => x.kind === 'removed')?.before).toBe('u')
  })

  it('flags a role change on the same id as changed', () => {
    const a = [m('1', 'user', 'same')]
    const b = [m('1', 'assistant', 'same')]
    const [d] = diffVersions(a, b)
    expect(d.kind).toBe('changed')
    expect(d.roleChanged).toBe(true)
  })

  it('follows b order then appends a-only removals', () => {
    const a = [m('1', 'system', 's'), m('2', 'user', 'u')]
    const b = [m('2', 'user', 'u'), m('1', 'system', 's')]
    const d = diffVersions(a, b)
    expect(d.map((x) => x.kind)).toEqual(['unchanged', 'unchanged'])
  })
})

describe('diffVersions (positional fallback)', () => {
  it('aligns by index when no ids overlap', () => {
    const a = [m('a1', 'system', 'one'), m('a2', 'user', 'two')]
    const b = [m('b1', 'system', 'one'), m('b2', 'user', 'TWO')]
    const d = diffVersions(a, b)
    expect(d.map((x) => x.kind)).toEqual(['unchanged', 'changed'])
  })
})

describe('diffSummary', () => {
  it('counts each kind', () => {
    const a = [m('1', 'system', 's'), m('2', 'user', 'u'), m('3', 'assistant', 'a')]
    const b = [m('1', 'system', 'S'), m('3', 'assistant', 'a'), m('4', 'user', 'new')]
    expect(diffSummary(diffVersions(a, b))).toEqual({ added: 1, removed: 1, changed: 1 })
  })
})
