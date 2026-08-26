import type { IStoragePort } from '@/core/ports/IStoragePort'

/**
 * Web `IStoragePort` backed by `localStorage`. Every key is namespaced
 * under a fixed prefix so `keys()` can enumerate just this app's entries
 * without picking up anything else that might share the origin.
 */
const PREFIX = 'infrakit:'

export class LocalStorageStoragePort implements IStoragePort {
  async get(key: string): Promise<string | null> {
    return localStorage.getItem(PREFIX + key)
  }

  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(PREFIX + key, value)
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(PREFIX + key)
  }

  async keys(): Promise<string[]> {
    const result: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(PREFIX)) result.push(key.slice(PREFIX.length))
    }
    return result
  }
}
