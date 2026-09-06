/**
 * Desktop-only: "keep monitoring when the window is closed" (MONITORS_MODULE_PLAN
 * M3). The Rust side (src-tauri/src/lib.rs) intercepts the window close and
 * hides to the tray instead of quitting when this is on, so the backend sidecar
 * — and its monitors — keep running. Persisted in localStorage; re-synced to
 * Rust on every app start.
 */
import { invoke, isTauri } from '@tauri-apps/api/core'

const KEY = 'infrakit:keep-monitoring-bg'

export function keepMonitoringInBackground(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export async function setKeepMonitoringInBackground(on: boolean): Promise<void> {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* private mode */
  }
  if (isTauri()) {
    try {
      await invoke('set_keep_alive', { enabled: on })
    } catch {
      /* older shell without the command */
    }
  }
}

/** Push the stored preference to Rust once on boot. Safe to call on web. */
export async function syncKeepAliveOnBoot(): Promise<void> {
  if (isTauri()) await setKeepMonitoringInBackground(keepMonitoringInBackground())
}
