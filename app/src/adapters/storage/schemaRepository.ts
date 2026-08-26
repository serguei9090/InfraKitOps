import type { ISchemaRepository } from '@/core/ports/ISchemaRepository'
import type { IStoragePort } from '@/core/ports/IStoragePort'
import { createStoragePort } from './createStoragePort'

/**
 * `ISchemaRepository` implemented on top of the general `IStoragePort`
 * (Phase 6) rather than talking to `localStorage` directly (how the Phase 5
 * version worked, before a general storage port existed). Same scheme as
 * before: `NAMES_KEY` holds a JSON-encoded list of every saved template
 * name, each template's JSON lives under its own `formflow_template_<name>`
 * key — `save`/`delete` keep the index and the per-template entries in
 * sync. Now automatically backed by `localStorage` on web or a real file
 * on disk on desktop, via whichever `IStoragePort` `createStoragePort()`
 * resolves to, with zero changes to this class.
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

export function createSchemaRepository(): ISchemaRepository {
  return new SchemaRepository(createStoragePort())
}
