/**
 * S3d — a small keyboard-shortcut registry. Framework-free. A combo string is
 * `Mod+…` where `Mod` = ⌘ on macOS / Ctrl elsewhere, optionally with `Shift` /
 * `Alt`, then the key (`S`, `Enter`, `K`, …).
 */

export interface ShortcutDef {
  id: string
  label: string
  /** where it applies, shown in Settings */
  scope: string
  defaultCombo: string
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'save', label: 'Save', scope: 'Prompt Library · Runbook editor', defaultCombo: 'Mod+S' },
  {
    id: 'primaryAction',
    label: 'Primary action (Fill & Copy · Save runbook draft)',
    scope: 'Prompt Library · Runbook editor',
    defaultCombo: 'Mod+Enter',
  },
]

export function shortcutById(id: string): ShortcutDef | undefined {
  return SHORTCUTS.find((s) => s.id === id)
}

/** Build the combo string for a keydown event, or null if no Mod is held. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (!(e.metaKey || e.ctrlKey)) return null
  const parts = ['Mod']
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  const key = normaliseKey(e.key)
  if (!key || key === 'Shift' || key === 'Alt' || key === 'Meta' || key === 'Control') return null
  parts.push(key)
  return parts.join('+')
}

/** Does this event match the combo string? */
export function eventMatchesCombo(e: KeyboardEvent, combo: string): boolean {
  return comboFromEvent(e) === combo
}

/** `Mod+Shift+S` → `⌘⇧S` (mac) / `Ctrl+Shift+S` (other). */
export function formatCombo(combo: string, mac: boolean): string {
  const parts = combo.split('+')
  return parts
    .map((p) => {
      if (p === 'Mod') return mac ? '⌘' : 'Ctrl'
      if (p === 'Shift') return mac ? '⇧' : 'Shift'
      if (p === 'Alt') return mac ? '⌥' : 'Alt'
      if (p === 'Enter') return '↵'
      return p
    })
    .join(mac ? '' : '+')
}

function normaliseKey(k: string): string {
  if (k.length === 1) return k.toUpperCase()
  return k
}
