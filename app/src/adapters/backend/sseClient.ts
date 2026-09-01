import { fetchEventSource } from '@microsoft/fetch-event-source'
import { BackendUnavailableError, getSessionToken, streamToken } from './backendClient'
import { resolveWebEndpoint } from './endpointOverride'
import { invoke, isTauri } from '@tauri-apps/api/core'

/**
 * SSE client for the streaming Network Toolkit tools (ping monitor, traceroute,
 * scans). Uses fetch-event-source so the bearer token rides in the
 * Authorization header rather than a query param. See NETWORK_MODULE_PLAN.md §2.1.
 */

interface Connection {
  endpoint: string
  token: string
  available: boolean
}

let conn: Connection | null = null

async function resolve(): Promise<Connection> {
  if (conn) return conn
  if (isTauri()) {
    try {
      conn = await invoke<Connection>('backend_endpoint')
    } catch {
      conn = { endpoint: '', token: '', available: false }
    }
  } else {
    const web = resolveWebEndpoint()
    conn = { ...web, available: web.available || getSessionToken() != null }
  }
  return conn
}

export interface StreamHandlers {
  /** A named SSE event with its parsed JSON payload. */
  onEvent: (name: string, data: unknown) => void
  /** Stream ended cleanly (server closed the connection). */
  onClose?: () => void
  /** Transport error (not a per-item error the tool reports itself). */
  onError?: (err: Error) => void
}

/**
 * Open an SSE stream under `/api/v1`. Returns an abort function.
 * `fetch-event-source` retries on transient drops automatically; a thrown
 * error inside `onopen`/`onerror` stops it for good.
 */
export function openStream(
  path: string,
  params: Record<string, string>,
  handlers: StreamHandlers,
): () => void {
  const controller = new AbortController()

  void (async () => {
    const c = await resolve()
    if (!c.available) {
      handlers.onError?.(new BackendUnavailableError())
      return
    }
    const qs = new URLSearchParams(params).toString()
    const url = `${c.endpoint}/api/v1${path}${qs ? `?${qs}` : ''}`
    const tok = streamToken(c.token)

    try {
      await fetchEventSource(url, {
        signal: controller.signal,
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
        openWhenHidden: true,
        onopen: async (res) => {
          if (res.ok) return
          throw new Error(`stream ${path}: ${res.status} ${res.statusText}`)
        },
        onmessage: (msg) => {
          if (!msg.event && !msg.data) return
          let data: unknown = msg.data
          try {
            data = JSON.parse(msg.data)
          } catch {
            /* keep raw string */
          }
          handlers.onEvent(msg.event || 'message', data)
        },
        onclose: () => {
          handlers.onClose?.()
        },
        onerror: (err) => {
          // Throwing stops the automatic retry loop.
          handlers.onError?.(err instanceof Error ? err : new Error(String(err)))
          throw err
        },
      })
    } catch (err) {
      if (controller.signal.aborted) return
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  })()

  return () => controller.abort()
}

export function resetSseConnection(): void {
  conn = null
}
