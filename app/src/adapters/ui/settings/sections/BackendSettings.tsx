import { useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBackendStore } from '@/stores/backendStore'
import { readEndpointOverride, writeEndpointOverride } from '@/adapters/backend/endpointOverride'
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

  const isWeb = !isTauri()
  const stored = readEndpointOverride()
  const [url, setUrl] = useState(stored?.url ?? '')
  const [token, setToken] = useState(stored?.token ?? '')
  const dirty = (stored?.url ?? '') !== url.trim() || (stored?.token ?? '') !== token.trim()

  function saveOverride() {
    writeEndpointOverride(url.trim() ? { url: url.trim(), token: token.trim() } : null)
    void retry()
  }
  function clearOverride() {
    writeEndpointOverride(null)
    setUrl('')
    setToken('')
    void retry()
  }

  const liveCaps = capabilities
    ? Object.entries(capabilities.capabilities)
        .filter(([, c]) => c.available)
        .map(([k]) => k)
    : []

  return (
    <>
      <SettingsGroup
        title="Backend service"
        description="The Go service that powers the Network Toolkit, Runbooks, the Vault and the AI layer. Desktop manages it as a sidecar; the web build points at its configured endpoint (see below)."
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
            <SettingsRow label="Transport">
              <span className="font-mono text-xs">
                {health.tls ? 'HTTPS' : 'HTTP'}
                {health.authMode === 'on' ? ' · multi-user' : ''}
              </span>
            </SettingsRow>
            {health.fingerprint && (
              <SettingsRow label="Cert fingerprint" hint="Share this so clients can pin the self-signed certificate.">
                <span className="font-mono text-[10px] break-all">{health.fingerprint}</span>
              </SettingsRow>
            )}
          </>
        )}
        <SettingsRow label="">
          <Button size="sm" variant="outline" onClick={() => void retry()} disabled={status === 'connecting'}>
            <RefreshCw className="size-3.5" /> Reconnect
          </Button>
        </SettingsRow>
      </SettingsGroup>

      {isWeb && (
        <SettingsGroup
          title="Endpoint override"
          description="Point this web app at a backend service of your choice. Stored in this browser only; overrides the address the app was built with. Leave blank to use the built-in default."
        >
          <SettingsRow label="Backend URL">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://backend.example.com"
              className="w-72 font-mono text-xs"
            />
          </SettingsRow>
          <SettingsRow label="Token">
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="per-launch bearer token (optional)"
              className="w-72 font-mono text-xs"
              type="password"
              autoComplete="off"
            />
          </SettingsRow>
          <SettingsRow label="">
            <div className="flex gap-2">
              <Button size="sm" onClick={saveOverride} disabled={!dirty}>
                Save &amp; reconnect
              </Button>
              {stored && (
                <Button size="sm" variant="ghost" onClick={clearOverride}>
                  Clear
                </Button>
              )}
            </div>
          </SettingsRow>
        </SettingsGroup>
      )}

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
