import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBackendStore } from '@/stores/backendStore'
import { SettingsGroup, SettingsRow } from '../SettingsScaffold'

const STATUS_LABEL: Record<string, string> = {
  unknown: 'not checked',
  connecting: 'connecting…',
  available: 'connected',
  unavailable: 'not reachable',
}

export function BackendSettings() {
  const status = useBackendStore((s) => s.status)
  const health = useBackendStore((s) => s.health)
  const capabilities = useBackendStore((s) => s.capabilities)
  const retry = useBackendStore((s) => s.retry)

  const liveCaps = capabilities
    ? Object.entries(capabilities.capabilities)
        .filter(([, c]) => c.available)
        .map(([k]) => k)
    : []

  return (
    <>
      <SettingsGroup
        title="Backend service"
        description="The Go service that powers the Network Toolkit, Runbooks, the Vault and the AI layer. Desktop manages it as a sidecar; the web build points at VITE_BACKEND_URL."
      >
        <SettingsRow label="Status">
          <span className="flex items-center gap-1.5 text-sm">
            {status === 'available' ? (
              <CheckCircle2 className="size-4 text-emerald-500" />
            ) : status === 'connecting' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <XCircle className="size-4 text-muted-foreground" />
            )}
            {STATUS_LABEL[status] ?? status}
          </span>
        </SettingsRow>
        {health && (
          <>
            <SettingsRow label="Version">
              <span className="font-mono text-xs">{health.version}</span>
            </SettingsRow>
            <SettingsRow label="Host">
              <span className="font-mono text-xs">
                {health.os} · pid {health.pid} · up {Math.round(health.uptimeSec / 60)}m
                {health.elevated ? ' · elevated' : ''}
              </span>
            </SettingsRow>
          </>
        )}
        <SettingsRow label="">
          <Button size="sm" variant="outline" onClick={() => void retry()} disabled={status === 'connecting'}>
            <RefreshCw className="size-3.5" /> Reconnect
          </Button>
        </SettingsRow>
      </SettingsGroup>

      {status === 'available' && (
        <SettingsGroup title="Live capabilities" description={`${liveCaps.length} of ${Object.keys(capabilities?.capabilities ?? {}).length} tool endpoints are runnable on this host.`}>
          <div className="flex flex-wrap gap-1">
            {liveCaps.map((c) => (
              <span key={c} className="rounded bg-accent/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {c}
              </span>
            ))}
          </div>
        </SettingsGroup>
      )}
    </>
  )
}
