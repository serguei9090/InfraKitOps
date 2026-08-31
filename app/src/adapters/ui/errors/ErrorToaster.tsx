import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useErrorStore, type SurfacedError } from '@/stores/errorStore'
import { isSticky } from '@/core/errors/appError'
import { cn } from '@/lib/utils'
import { ErrorIcon } from './errorIcon'

/**
 * Mounted once in the shell. Renders the errorStore queue as a bottom-right
 * stack. Non-sticky toasts auto-dismiss; auth / internal / backend_down stay
 * until dismissed. See ERROR_HANDLING_PLAN.md §5.3.
 */
export function ErrorToaster() {
  const errors = useErrorStore((s) => s.errors)
  const dismiss = useErrorStore((s) => s.dismiss)

  if (errors.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {errors.slice(-4).map((e) => (
        <Toast key={e.id} error={e} onDismiss={() => dismiss(e.id)} />
      ))}
    </div>
  )
}

function Toast({ error, onDismiss }: { error: SurfacedError; onDismiss: () => void }) {
  const sticky = isSticky(error.code)

  useEffect(() => {
    if (sticky) return
    const t = setTimeout(onDismiss, 6000)
    return () => clearTimeout(t)
  }, [sticky, onDismiss])

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex gap-2.5 rounded-lg border border-border/70 bg-card p-3 text-sm shadow-lg',
      )}
    >
      <ErrorIcon code={error.code} className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <span className="flex-1 font-medium">{error.title}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismiss}
            className="-mr-1 -mt-1 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
        {error.hint && <p className="mt-0.5 text-xs text-muted-foreground">{error.hint}</p>}
        {(error.detail && error.detail !== error.title) || error.source ? (
          <details className="mt-1 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Details</summary>
            {error.source && <div className="mt-1">from {error.source}</div>}
            {error.detail && error.detail !== error.title && (
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">
                {error.detail}
              </pre>
            )}
          </details>
        ) : null}
      </div>
    </div>
  )
}
