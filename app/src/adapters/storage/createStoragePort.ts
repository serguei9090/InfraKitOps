import { isTauri } from '@tauri-apps/api/core'
import type { IStoragePort } from '@/core/ports/IStoragePort'
import { LocalStorageStoragePort } from './localStorageStoragePort'
import { TauriFsStoragePort } from './tauriFsStoragePort'

let cached: IStoragePort | null = null

/**
 * Picks the right `IStoragePort` for the runtime the app is actually
 * running in — `isTauri()` is true only inside the Tauri webview (desktop),
 * false in a plain browser tab (web build), so the same call site works
 * unmodified on both targets.
 */
export function createStoragePort(): IStoragePort {
  if (!cached) {
    cached = isTauri() ? new TauriFsStoragePort() : new LocalStorageStoragePort()
  }
  return cached
}
