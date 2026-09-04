import type { ISchemaRepository, SchemaEntry } from '@/core/ports/ISchemaRepository'
import type { IStoragePort } from '@/core/ports/IStoragePort'
import { createStoragePort } from './createStoragePort'

/**
 * FormFlow form persistence (POLISH_PLAN.md PL2). id-keyed:
 *
 *   formflow_index      → [{ id, name }]
 *   formflow_form_<id>  → one form's JSON
 *
 * Under `--auth on` a `BackendSchemaRepository` takes over so forms live
 * server-side and can be shared. `createSchemaRepository()` picks per call by
 * auth mode, mirroring `promptRepository.ts`.
 *
 * Migrates the pre-PL2 name-keyed layout (`formflow_template_names` +
 * `formflow_template_<name>`) on first `list()`.
 */
const INDEX_KEY = 'formflow_index'
const OLD_NAMES_KEY = 'formflow_template_names'

const formKey = (id: string) => `formflow_form_${id}`
const oldKey = (name: string) => `formflow_template_${name}`

const genId = () =>
  `form_${
    typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
  }`

interface IndexEntry {
  id: string
  name: string
}

export class SchemaRepository implements ISchemaRepository {
  private readonly storage: IStoragePort
  private migrated = false
  constructor(storage: IStoragePort) {
    this.storage = storage
  }

  private async readIndex(): Promise<IndexEntry[]> {
    const raw = await this.storage.get(INDEX_KEY)
    if (raw == null) return []
    try {
      const v: unknown = JSON.parse(raw)
      return Array.isArray(v) ? (v as IndexEntry[]).filter((e) => e && e.id && e.name) : []
    } catch {
      return []
    }
  }
  private writeIndex(idx: IndexEntry[]): Promise<void> {
    return this.storage.set(INDEX_KEY, JSON.stringify(idx))
  }

  private async migrate(): Promise<void> {
    if (this.migrated) return
    this.migrated = true
    const rawNames = await this.storage.get(OLD_NAMES_KEY)
    if (rawNames == null) return
    let names: string[] = []
    try {
      const v: unknown = JSON.parse(rawNames)
      names = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    } catch {
      names = []
    }
    if (names.length === 0) {
      await this.storage.remove(OLD_NAMES_KEY)
      return
    }
    const idx = await this.readIndex()
    for (const name of names) {
      const json = await this.storage.get(oldKey(name))
      if (json == null) continue
      const id = genId()
      idx.push({ id, name })
      await this.storage.set(formKey(id), json)
      await this.storage.remove(oldKey(name))
    }
    await this.writeIndex(idx)
    await this.storage.remove(OLD_NAMES_KEY)
  }

  async list(): Promise<SchemaEntry[]> {
    await this.migrate()
    const idx = await this.readIndex()
    return idx
      .map((e) => ({ id: e.id, name: e.name, canEdit: true, shared: false }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async load(id: string): Promise<string | null> {
    return this.storage.get(formKey(id))
  }

  async save(id: string | null, name: string, schemaJson: string): Promise<string> {
    await this.migrate()
    const idx = await this.readIndex()
    const finalId = id ?? genId()
    const existing = idx.find((e) => e.id === finalId)
    if (existing) existing.name = name
    else idx.push({ id: finalId, name })
    await this.writeIndex(idx)
    await this.storage.set(formKey(finalId), schemaJson)
    return finalId
  }

  async delete(id: string): Promise<void> {
    const idx = await this.readIndex()
    const next = idx.filter((e) => e.id !== id)
    if (next.length !== idx.length) await this.writeIndex(next)
    await this.storage.remove(formKey(id))
  }
}

// --- multi-user: server-side, shareable -----------------------------

class BackendSchemaRepository implements ISchemaRepository {
  async list(): Promise<SchemaEntry[]> {
    const { listForms } = await import('@/adapters/backend/formClient')
    const forms = await listForms()
    return forms
      .map((f) => ({ id: f.id, name: f.name, canEdit: f.canEdit, shared: f.shared }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async load(id: string): Promise<string | null> {
    const { getForm } = await import('@/adapters/backend/formClient')
    return JSON.stringify(await getForm(id))
  }

  async save(id: string | null, name: string, schemaJson: string): Promise<string> {
    const finalId = id ?? genId()
    const { putForm } = await import('@/adapters/backend/formClient')
    await putForm(finalId, name, JSON.parse(schemaJson))
    return finalId
  }

  async delete(id: string): Promise<void> {
    const { deleteForm } = await import('@/adapters/backend/formClient')
    await deleteForm(id)
  }
}

class ModeAwareSchemaRepository implements ISchemaRepository {
  private localRepo: SchemaRepository | null = null
  private backendRepo: BackendSchemaRepository | null = null

  private local(): SchemaRepository {
    if (!this.localRepo) this.localRepo = new SchemaRepository(createStoragePort())
    return this.localRepo
  }

  private async pick(): Promise<ISchemaRepository> {
    const { useAuthStore } = await import('@/stores/authStore')
    if (useAuthStore.getState().mode === 'on') {
      if (!this.backendRepo) this.backendRepo = new BackendSchemaRepository()
      return this.backendRepo
    }
    return this.local()
  }

  async list() {
    return (await this.pick()).list()
  }
  async load(id: string) {
    return (await this.pick()).load(id)
  }
  async save(id: string | null, name: string, json: string) {
    return (await this.pick()).save(id, name, json)
  }
  async delete(id: string) {
    return (await this.pick()).delete(id)
  }
}

export function createSchemaRepository(): ISchemaRepository {
  return new ModeAwareSchemaRepository()
}
