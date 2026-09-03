import type { ISchemaRepository } from '@/core/ports/ISchemaRepository'
import type { IStoragePort } from '@/core/ports/IStoragePort'
import { createStoragePort } from './createStoragePort'

/**
 * `ISchemaRepository` on top of the general `IStoragePort` — same
 * index-plus-entries scheme as before: `NAMES_KEY` holds the list of every
 * saved template name, each template's JSON lives under
 * `formflow_template_<name>`. Backed by `localStorage` on web or a real file
 * on desktop.
 *
 * Under `--auth on` a `BackendSchemaRepository` takes over so forms live
 * server-side and can be shared (SHARING_PLAN.md SH3). `createSchemaRepository`
 * picks per call by auth mode, mirroring `promptRepository.ts`.
 */
const NAMES_KEY = 'formflow_template_names'

function templateKey(name: string): string {
  return `formflow_template_${name}`
}

export class SchemaRepository implements ISchemaRepository {
  private readonly storage: IStoragePort
  constructor(storage: IStoragePort) {
    this.storage = storage
  }

  private async readNames(): Promise<string[]> {
    const raw = await this.storage.get(NAMES_KEY)
    if (raw == null) return []
    try {
      const decoded: unknown = JSON.parse(raw)
      return Array.isArray(decoded) ? decoded.filter((v): v is string => typeof v === 'string') : []
    } catch {
      return []
    }
  }

  private writeNames(names: string[]): Promise<void> {
    return this.storage.set(NAMES_KEY, JSON.stringify(names))
  }

  async listNames(): Promise<string[]> {
    return [...(await this.readNames())].sort()
  }

  async load(name: string): Promise<string | null> {
    return this.storage.get(templateKey(name))
  }

  async save(name: string, schemaJson: string): Promise<void> {
    const names = await this.readNames()
    if (!names.includes(name)) {
      names.push(name)
      await this.writeNames(names)
    }
    await this.storage.set(templateKey(name), schemaJson)
  }

  async delete(name: string): Promise<void> {
    const names = await this.readNames()
    const next = names.filter((n) => n !== name)
    if (next.length !== names.length) {
      await this.writeNames(next)
    }
    await this.storage.remove(templateKey(name))
  }
}

// --- multi-user: server-side, shareable -----------------------------

const SHARED_SUFFIX = ' (shared)'
const genId = () =>
  `form_${
    typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
  }`

class BackendSchemaRepository implements ISchemaRepository {
  /** display name → entry. Rebuilt on every listNames/load. */
  private byDisplay = new Map<string, { id: string; name: string; canEdit: boolean; shared: boolean }>()

  private async refresh() {
    const { listForms } = await import('@/adapters/backend/formClient')
    const forms = await listForms()
    this.byDisplay.clear()
    for (const f of forms) {
      let display = f.shared ? f.name + SHARED_SUFFIX : f.name
      // de-collide identical display names (two shared "x", etc.)
      let n = 2
      while (this.byDisplay.has(display)) display = `${f.name}${SHARED_SUFFIX} ${n++}`
      this.byDisplay.set(display, { id: f.id, name: f.name, canEdit: f.canEdit, shared: f.shared })
    }
  }

  async listNames(): Promise<string[]> {
    await this.refresh()
    return [...this.byDisplay.keys()].sort()
  }

  async load(display: string): Promise<string | null> {
    if (this.byDisplay.size === 0) await this.refresh()
    const hit = this.byDisplay.get(display)
    if (!hit) return null
    const { getForm } = await import('@/adapters/backend/formClient')
    const blob = await getForm(hit.id)
    return JSON.stringify(blob)
  }

  async save(name: string, schemaJson: string): Promise<void> {
    await this.refresh()
    const own = this.byDisplay.get(name) ?? this.byDisplay.get(name + SHARED_SUFFIX)
    const id = own && !own.shared ? own.id : own?.shared && own.canEdit ? own.id : genId()
    const { putForm } = await import('@/adapters/backend/formClient')
    await putForm(id, name, JSON.parse(schemaJson))
    await this.refresh()
  }

  async delete(display: string): Promise<void> {
    if (this.byDisplay.size === 0) await this.refresh()
    const hit = this.byDisplay.get(display)
    if (!hit || hit.shared) return // only the owner deletes
    const { deleteForm } = await import('@/adapters/backend/formClient')
    await deleteForm(hit.id)
    await this.refresh()
  }

  ownedFormId(name: string): string | undefined {
    const hit = this.byDisplay.get(name)
    return hit && !hit.shared ? hit.id : undefined
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

  async listNames() {
    return (await this.pick()).listNames()
  }
  async load(name: string) {
    return (await this.pick()).load(name)
  }
  async save(name: string, json: string) {
    return (await this.pick()).save(name, json)
  }
  async delete(name: string) {
    return (await this.pick()).delete(name)
  }
  ownedFormId(name: string): string | undefined {
    return this.backendRepo?.ownedFormId(name)
  }
}

export function createSchemaRepository(): ISchemaRepository {
  return new ModeAwareSchemaRepository()
}
