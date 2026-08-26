import { BaseDirectory } from '@tauri-apps/api/path'
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import type { IStoragePort } from '@/core/ports/IStoragePort'

/**
 * Desktop `IStoragePort` backed by the Tauri `fs` plugin, scoped to
 * `$APPDATA` (see `src-tauri/capabilities/default.json`). Keeps everything
 * in one JSON file rather than one file per key — this port only needs
 * flat key/value storage for small amounts of data (prefs, saved
 * templates), so a single read-modify-write of one small file is simpler
 * and avoids a filename-sanitization problem for arbitrary keys.
 */
const STORAGE_FILE = 'storage.json'
const BASE_DIR = BaseDirectory.AppData

async function readAll(): Promise<Record<string, string>> {
  if (!(await exists(STORAGE_FILE, { baseDir: BASE_DIR }))) return {}
  try {
    const raw = await readTextFile(STORAGE_FILE, { baseDir: BASE_DIR })
    const parsed: unknown = JSON.parse(raw)
    return isStringRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function writeAll(map: Record<string, string>): Promise<void> {
  if (!(await exists('', { baseDir: BASE_DIR }))) {
    await mkdir('', { baseDir: BASE_DIR, recursive: true })
  }
  await writeTextFile(STORAGE_FILE, JSON.stringify(map), { baseDir: BASE_DIR })
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class TauriFsStoragePort implements IStoragePort {
  async get(key: string): Promise<string | null> {
    const map = await readAll()
    return map[key] ?? null
  }

  async set(key: string, value: string): Promise<void> {
    const map = await readAll()
    map[key] = value
    await writeAll(map)
  }

  async remove(key: string): Promise<void> {
    const map = await readAll()
    if (key in map) {
      delete map[key]
      await writeAll(map)
    }
  }

  async keys(): Promise<string[]> {
    return Object.keys(await readAll())
  }
}
