import { useEffect, useRef } from 'react'
import { eventMatchesCombo } from '@/core/shortcuts/shortcuts'
import { useShortcutStore } from '@/stores/shortcutStore'

/**
 * S3d — bind `handler` to the shortcut registered under `id` (its override or
 * default combo). A global keydown listener; `handler` runs after
 * `preventDefault()`. Pass `enabled: false` to suspend it.
 */
export function useShortcut(id: string, handler: () => void, enabled = true): void {
  const combo = useShortcutStore((s) => s.combo(id))
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!enabled || !combo) return
    function onKey(e: KeyboardEvent) {
      if (eventMatchesCombo(e, combo)) {
        e.preventDefault()
        handlerRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [combo, enabled])
}
