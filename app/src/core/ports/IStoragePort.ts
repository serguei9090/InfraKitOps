/**
 * Outbound port for persisting settings, prefs, and saved templates.
 * Mirrors `IStoragePort` in the Flutter reference app
 * (`lib/core/ports/i_storage_port.dart`). Implementations (Phase 6):
 * web → localStorage/IndexedDB, desktop → Tauri `fs` plugin.
 */
export interface IStoragePort {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  keys(): Promise<string[]>
}
