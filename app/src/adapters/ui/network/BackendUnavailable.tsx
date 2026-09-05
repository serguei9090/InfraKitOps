import { Loader2, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBackendStore } from '@/stores/backendStore'

interface BackendUnavailableProps {
  onRetry: () => void
  retrying?: boolean
  /** Shown instead of the generic copy when a specific tool is gated for another reason. */
  reason?: string
}

/**
 * Empty state for a Network Toolkit tool when the backend service is not
 * reachable. The 44 client-only tools never render this — see
 * NETWORK_MODULE_PLAN.md §2.1.
 */
export function BackendUnavailable({ onRetry, retrying, reason }: BackendUnavailableProps) {
  // The app-wide auto-connect loop keeps probing; reflect that here so the
  // button reads "Connecting…" during warm-up rather than an idle "Retry".
  const autoReconnecting = useBackendStore((s) => s.reconnecting)
  const busy = retrying || autoReconnecting
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Unplug className="size-6" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold">Network backend not connected</h2>
        <p className="text-sm text-muted-foreground">
          {reason ??
            'This tool runs against the local infrakit-backend service. The desktop app starts it automatically; the web build needs it configured.'}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={busy} className="gap-1.5">
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        {busy ? 'Connecting…' : 'Retry'}
      </Button>
      <details className="w-full text-left text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Setup</summary>
        <div className="mt-2 space-y-2">
          <p>
            <span className="font-medium text-foreground">Desktop:</span> if this persists, the sidecar failed to
            start — check the app log.
          </p>
          <p>
            <span className="font-medium text-foreground">Web / dev:</span> run the service and point the app at it:
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono">
{`cd backend
go run ./cmd/infrakit-backend --addr 127.0.0.1:8765 --token dev

# app/.env.local
VITE_BACKEND_URL=http://127.0.0.1:8765
VITE_BACKEND_TOKEN=dev`}
          </pre>
        </div>
      </details>
    </div>
  )
}
