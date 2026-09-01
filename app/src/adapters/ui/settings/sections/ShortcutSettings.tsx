import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SHORTCUTS, comboFromEvent, formatCombo, shortcutById } from '@/core/shortcuts/shortcuts'
import { useShortcutStore } from '@/stores/shortcutStore'
import { cn } from '@/lib/utils'

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

export function ShortcutSettings() {
  const overrides = useShortcutStore((s) => s.overrides)
  const combo = useShortcutStore((s) => s.combo)
  const setOverride = useShortcutStore((s) => s.setOverride)
  const resetOne = useShortcutStore((s) => s.resetOne)
  const resetAll = useShortcutStore((s) => s.resetAll)
  const conflicts = useShortcutStore((s) => s.conflicts)

  const [capturing, setCapturing] = useState<string | null>(null)

  useEffect(() => {
    if (!capturing) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setCapturing(null)
        return
      }
      const c = comboFromEvent(e)
      if (!c) return
      e.preventDefault()
      setOverride(capturing!, c)
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, setOverride])

  const dirty = Object.keys(overrides).length > 0

  return (
    <div className="flex flex-col gap-1.5">
      {SHORTCUTS.map((s) => {
        const cur = combo(s.id)
        const clash = conflicts(cur, s.id)
        const isOverridden = overrides[s.id] != null
        return (
          <div key={s.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <div>{s.label}</div>
              <div className="text-[11px] text-muted-foreground">{s.scope}</div>
              {clash.length > 0 && (
                <div className="text-[11px] text-amber-600 dark:text-amber-500">
                  Also bound to: {clash.map((id) => shortcutById(id)?.label).join(', ')}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCapturing(s.id)}
              className={cn(
                'min-w-24 rounded-md border px-2 py-1 text-center font-mono text-xs',
                capturing === s.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/60 hover:bg-accent/40',
              )}
            >
              {capturing === s.id ? 'Press keys…' : formatCombo(cur, IS_MAC)}
            </button>
            {isOverridden && (
              <button
                type="button"
                aria-label={`Reset ${s.label}`}
                onClick={() => resetOne(s.id)}
                className="text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3.5" />
              </button>
            )}
          </div>
        )
      })}
      {dirty && (
        <Button size="xs" variant="ghost" className="mt-1 self-start" onClick={() => resetAll()}>
          Reset all shortcuts
        </Button>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        Click a shortcut, then press the new combination (must include {IS_MAC ? '⌘' : 'Ctrl'}). Esc cancels.
      </p>
    </div>
  )
}
