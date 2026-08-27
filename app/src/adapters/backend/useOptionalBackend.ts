import { useEffect } from 'react'
import { useBackendStore } from '@/stores/backendStore'

/**
 * For client-first tools that gain an optional "power mode" when the Go
 * backend is running (SSH keygen RSA/ECDSA, PDF engine, config validation,
 * robust QR decode, live-cert fetch). Unlike the Network module's
 * `NetworkToolScaffold`, these screens keep their normal client-side UI and
 * only light up the extra capability when `available` is true.
 */
export function useOptionalBackend(toolId: string): {
  status: ReturnType<typeof useBackendStore.getState>['status']
  available: boolean
  reason: string | undefined
  retry: () => Promise<void>
} {
  const status = useBackendStore((s) => s.status)
  const refresh = useBackendStore((s) => s.refresh)
  const retry = useBackendStore((s) => s.retry)
  const cap = useBackendStore((s) => s.capabilities?.capabilities[toolId])

  useEffect(() => {
    if (status === 'unknown') void refresh()
  }, [status, refresh])

  return {
    status,
    available: status === 'available' && (cap?.available ?? false),
    reason: cap?.reason,
    retry,
  }
}
