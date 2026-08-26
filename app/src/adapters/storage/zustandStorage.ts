import type { StateStorage } from 'zustand/middleware'
import type { IStoragePort } from '@/core/ports/IStoragePort'

/** Adapts an `IStoragePort` to zustand `persist`'s `StateStorage` shape. */
export function storagePortAsZustandStorage(port: IStoragePort): StateStorage {
  return {
    getItem: (name) => port.get(name),
    setItem: (name, value) => port.set(name, value),
    removeItem: (name) => port.remove(name),
  }
}
