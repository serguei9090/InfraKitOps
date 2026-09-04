import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./createStoragePort', () => ({ createStoragePort: () => mem }))

import type { IStoragePort } from '@/core/ports/IStoragePort'
import { SchemaRepository } from './schemaRepository'

let store: Map<string, string>
const mem: IStoragePort = {
  get: async (k) => store.get(k) ?? null,
  set: async (k, v) => {
    store.set(k, v)
  },
  remove: async (k) => {
    store.delete(k)
  },
}

const blob = (name: string) => JSON.stringify({ name, schema: {}, values: {} })

describe('SchemaRepository (id-keyed, PL2)', () => {
  beforeEach(() => {
    store = new Map()
  })

  it('save → list → load round-trips by id', async () => {
    const r = new SchemaRepository(mem)
    const id = await r.save(null, 'nginx.conf', blob('nginx.conf'))
    expect(id).toMatch(/^form_/)

    const entries = await r.list()
    expect(entries).toEqual([{ id, name: 'nginx.conf', canEdit: true, shared: false }])
    expect(await r.load(id)).toBe(blob('nginx.conf'))

    // rename in place keeps the id
    const id2 = await r.save(id, 'nginx-prod.conf', blob('nginx-prod.conf'))
    expect(id2).toBe(id)
    expect((await r.list())[0].name).toBe('nginx-prod.conf')

    await r.delete(id)
    expect(await r.list()).toEqual([])
    expect(await r.load(id)).toBeNull()
  })

  it('migrates the pre-PL2 name-keyed layout on first list()', async () => {
    store.set('formflow_template_names', JSON.stringify(['a', 'b']))
    store.set('formflow_template_a', blob('a'))
    store.set('formflow_template_b', blob('b'))

    const r = new SchemaRepository(mem)
    const entries = await r.list()

    expect(entries.map((e) => e.name).sort()).toEqual(['a', 'b'])
    expect(store.has('formflow_template_names')).toBe(false)
    expect(store.has('formflow_template_a')).toBe(false)

    const a = entries.find((e) => e.name === 'a')!
    expect(await r.load(a.id)).toBe(blob('a'))

    // idempotent — a second list() doesn't duplicate
    expect((await r.list()).length).toBe(2)
  })
})
