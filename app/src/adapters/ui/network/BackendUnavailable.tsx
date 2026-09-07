import { useState } from 'react'
import { Check, Copy, Download, Loader2, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBackendStore } from '@/stores/backendStore'
import { DEMO_MODE, DOCKER_ONELINER, RELEASES_URL } from '@/lib/demoMode'
import { readEndpointOverride } from '@/adapters/backend/endpointOverride'

/** A shell command shown in full (wraps) with a copy button. */
function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-start gap-1.5 rounded-md bg-muted p-2">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground">
        {command}
      </code>
      <button
        type="button"
        aria-label="Copy command"
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } catch {
            /* clipboard blocked */
          }
        }}
      >
        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

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

  // On the public demo, this module simply isn't available — point at the
  // download instead of dev-setup instructions (unless the visitor has
  // already wired their own backend via the endpoint override).
  if (DEMO_MODE && !readEndpointOverride()) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Unplug className="size-6" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold">Not on the live demo</h2>
          <p className="text-sm text-muted-foreground">
            {reason ??
              'This module runs commands on the InfraKit backend — SSH, Ansible, network probes, LLM calls. The live demo is client-only. Run it locally to use this.'}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" render={<a href={RELEASES_URL} target="_blank" rel="noreferrer" />} className="gap-1.5">
            <Download className="size-4" /> Download the app
          </Button>
        </div>
        <div className="w-full space-y-1.5 text-left text-xs text-muted-foreground">
          <p>…or one line with Docker:</p>
          <CommandBlock command={DOCKER_ONELINER} />
          <p>
            Already running a backend? Set it in <span className="font-medium text-foreground">Settings → Backend → Endpoint override</span>.
          </p>
        </div>
      </div>
    )
  }

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
