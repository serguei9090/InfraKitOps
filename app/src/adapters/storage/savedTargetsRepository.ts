import type { IStoragePort } from '@/core/ports/IStoragePort'
import { createStoragePort } from './createStoragePort'

/**
 * A saved query for a Network Toolkit tool — the right-pane "Saved Targets"
 * list (NETWORK_MODULE_PLAN.md §3). One flat list under a single storage key,
 * filtered by `tool` in the pane. Backed by IStoragePort like SchemaRepository.
 */
export interface SavedTarget {
  id: string
  tool: string
  label: string
  /** Optional grouping folder; '' = ungrouped. */
  folder: string
  /** The tool's run params to restore. */
  params: Record<string, unknown>
  createdAt: number
}

const KEY = 'network_saved_targets'

export class SavedTargetsRepository {
  private readonly storage: IStoragePort
  constructor(storage: IStoragePort) {
    this.storage = storage
  }

  private async readAll(): Promise<SavedTarget[]> {
    const raw = await this.storage.get(KEY)
    if (raw == null) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as SavedTarget[]) : []
    } catch {
      return []
    }
  }

  private writeAll(list: SavedTarget[]): Promise<void> {
    return this.storage.set(KEY, JSON.stringify(list))
  }

  /** All saved targets for one tool, newest first. */
  async list(tool: string): Promise<SavedTarget[]> {
    const all = await this.readAll()
    return all.filter((t) => t.tool === tool).sort((a, b) => b.createdAt - a.createdAt)
  }

  async add(entry: Omit<SavedTarget, 'id' | 'createdAt'>): Promise<SavedTarget> {
    const all = await this.readAll()
    const saved: SavedTarget = {
      ...entry,
      id: `${entry.tool}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    }
    all.push(saved)
    await this.writeAll(all)
    return saved
  }

  async update(id: string, patch: Partial<Pick<SavedTarget, 'label' | 'folder' | 'params'>>): Promise<void> {
    const all = await this.readAll()
    const next = all.map((t) => (t.id === id ? { ...t, ...patch } : t))
    await this.writeAll(next)
  }

  async remove(id: string): Promise<void> {
    const all = await this.readAll()
    await this.writeAll(all.filter((t) => t.id !== id))
  }
}

let cached: SavedTargetsRepository | null = null
export function createSavedTargetsRepository(): SavedTargetsRepository {
  if (!cached) cached = new SavedTargetsRepository(createStoragePort())
  return cached
}
