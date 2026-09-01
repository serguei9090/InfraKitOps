import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * S3a — a "Reset this section" control. Two-click confirm inline (no dialog),
 * so a section drops it at the bottom of its panel.
 */
export function SettingsResetButton({
  label = 'Reset this section',
  onReset,
}: {
  label?: string
  onReset: () => void | Promise<void>
}) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <div className="mt-6 border-t border-border/50 pt-4">
      {armed ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Reset to defaults?</span>
          <Button
            size="xs"
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onReset()
              } finally {
                setBusy(false)
                setArmed(false)
              }
            }}
          >
            Yes, reset
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setArmed(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="xs" variant="outline" onClick={() => setArmed(true)}>
          <RotateCcw className="size-3.5" />
          {label}
        </Button>
      )}
    </div>
  )
}
