/**
 * IndexedDB-backed run history for the pure-web build, used when the Go
 * backend (and its SQLite history store) is not reachable. Mirrors the
 * sidecar's `/api/v1/history` semantics — same `RunEnvelope` in, same
 * `RunSummary` / `StoredRun` out, same prune policy (retention-days cutoff +
 * keep-newest-N per (tool,target), pinned/labelled runs exempt). See
 * NETWORK_MODULE_PLAN.md §N4.
 *
 * `historyClient.ts` falls back to this transparently, so the History drawer,
 * Compare view and auto-save need no knowledge of which store is active.
 */
import type { RunEnvelope, RunStatus, RunSummary, ResultShape, StoredRun } from '@/core/network/history'

const DB_NAME = 'infrakit-network-history'
const STORE = 'runs'
const DB_VERSION = 1

interface HistoryRecord {
  id: number
  tool: string
  target: string
  startedAt: number
  finishedAt?: number
  status: RunStatus
  resultShape: ResultShape
  summary?: Record<string, unknown>
  params: Record<string, unknown>
  result: unknown
  pinned: boolean
  label?: string
}

export interface PrunePolicy {
  retentionDays: number
  maxPerTarget: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
        os.createIndex('tool', 'tool', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('could not open history database'))
  })
  return dbPromise
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE)
}

function reqAsync<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'))
  })
}

/** Whether IndexedDB is usable in this context at all. */
export function localHistoryAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

function toSummary(r: HistoryRecord): RunSummary {
  return {
    id: r.id,
    tool: r.tool,
    target: r.target,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    status: r.status,
    resultShape: r.resultShape,
    summary: r.summary,
    pinned: r.pinned,
    label: r.label,
  }
}

async function allForTool(db: IDBDatabase, tool: string): Promise<HistoryRecord[]> {
  const index = tx(db, 'readonly').index('tool')
  return reqAsync(index.getAll(IDBKeyRange.only(tool)))
}

export async function localSaveRun(env: RunEnvelope, policy: PrunePolicy): Promise<number | null> {
  if (!localHistoryAvailable()) return null
  try {
    const db = await openDb()
    const record: Omit<HistoryRecord, 'id'> = {
      tool: env.tool,
      target: env.target,
      startedAt: env.startedAt,
      finishedAt: env.finishedAt,
      status: env.status,
      resultShape: env.resultShape,
      summary: env.summary,
      params: env.params,
      result: env.result,
      pinned: false,
    }
    const id = (await reqAsync(tx(db, 'readwrite').add(record as HistoryRecord))) as number
    await pruneGroup(db, env.tool, env.target, policy)
    return id
  } catch {
    return null
  }
}

async function pruneGroup(db: IDBDatabase, tool: string, target: string, policy: PrunePolicy): Promise<void> {
  const { retentionDays, maxPerTarget } = policy
  if (retentionDays <= 0 && maxPerTarget <= 0) return

  const group = (await allForTool(db, tool))
    .filter((r) => r.target === target)
    .sort((a, b) => b.startedAt - a.startedAt)

  const cutoff = retentionDays > 0 ? Date.now() - retentionDays * 86_400_000 : -Infinity
  const keepN = maxPerTarget > 0 ? maxPerTarget : Number.MAX_SAFE_INTEGER
  const protectedNewest = new Set(group.slice(0, keepN).map((r) => r.id))

  const doomed = group.filter(
    (r) => !r.pinned && !r.label && r.startedAt < cutoff && !protectedNewest.has(r.id),
  )
  if (doomed.length === 0) return
  const store = tx(db, 'readwrite')
  await Promise.all(doomed.map((r) => reqAsync(store.delete(r.id))))
}

export async function localListRuns(tool: string, target?: string, limit = 100): Promise<RunSummary[]> {
  if (!localHistoryAvailable()) return []
  try {
    const db = await openDb()
    let rows = await allForTool(db, tool)
    if (target) rows = rows.filter((r) => r.target === target)
    rows.sort((a, b) => b.startedAt - a.startedAt)
    return rows.slice(0, limit).map(toSummary)
  } catch {
    return []
  }
}

export async function localGetRun(id: number): Promise<StoredRun | null> {
  if (!localHistoryAvailable()) return null
  try {
    const db = await openDb()
    const r = (await reqAsync(tx(db, 'readonly').get(id))) as HistoryRecord | undefined
    if (!r) return null
    return { ...toSummary(r), params: r.params, result: r.result }
  } catch {
    return null
  }
}

async function patch(id: number, mutate: (r: HistoryRecord) => void): Promise<void> {
  if (!localHistoryAvailable()) return
  const db = await openDb()
  const store = tx(db, 'readwrite')
  const r = (await reqAsync(store.get(id))) as HistoryRecord | undefined
  if (!r) return
  mutate(r)
  await reqAsync(store.put(r))
}

export function localPinRun(id: number, pinned: boolean): Promise<void> {
  return patch(id, (r) => {
    r.pinned = pinned
  })
}

export function localLabelRun(id: number, label: string): Promise<void> {
  return patch(id, (r) => {
    r.label = label || undefined
  })
}

export async function localDeleteRun(id: number): Promise<void> {
  if (!localHistoryAvailable()) return
  const db = await openDb()
  await reqAsync(tx(db, 'readwrite').delete(id))
}
