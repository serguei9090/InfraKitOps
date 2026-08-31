import { invoke, isTauri } from '@tauri-apps/api/core'

/**
 * Talks to the `infrakit-backend` network sidecar (desktop) or a standalone
 * instance of the same service (web). Every network tool goes through this;
 * the 44 client-only tools never touch it. See NETWORK_MODULE_PLAN.md §2.1.
 *
 * Resolution:
 *   - desktop (Tauri): the `backend_endpoint` command returns { endpoint,
 *     token, available }, filled in once the sidecar announces its port.
 *   - web: `VITE_BACKEND_URL` (+ optional `VITE_BACKEND_TOKEN`), else the
 *     backend is treated as unavailable and the tools show a setup banner.
 */

export interface BackendConnection {
  endpoint: string
  token: string
  available: boolean
}

let resolved: BackendConnection | null = null

async function resolveConnection(): Promise<BackendConnection> {
  if (resolved) return resolved
  if (isTauri()) {
    try {
      resolved = await invoke<BackendConnection>('backend_endpoint')
    } catch {
      resolved = { endpoint: '', token: '', available: false }
    }
  } else {
    const url = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '') ?? ''
    const token = (import.meta.env.VITE_BACKEND_TOKEN as string | undefined) ?? ''
    resolved = { endpoint: url, token, available: url.length > 0 }
  }
  return resolved
}

/** Forget the cached connection so the next call re-resolves it (e.g. after a retry). */
export function resetBackendConnection(): void {
  resolved = null
}

function authHeaders(token: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export class BackendUnavailableError extends Error {
  constructor() {
    super('The network backend service is not connected.')
    this.name = 'BackendUnavailableError'
  }
}

export interface HealthInfo {
  status: string
  version: string
  pid: number
  uptimeSec: number
  elevated: boolean
  os: string
}

export interface ToolCapability {
  available: boolean
  reason?: string
  needsElevation?: boolean
}

export interface CapabilitiesInfo {
  elevated: boolean
  capabilities: Record<string, ToolCapability>
  /** Runbooks module: which executor kinds this host can run. */
  runbookExecutors?: Record<string, boolean>
  /** AI layer: which provider kinds this build supports. */
  llmProviders?: string[]
}

/** GET a JSON endpoint under `/api/v1`. Throws `BackendUnavailableError` if no backend. */
export async function backendGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const conn = await resolveConnection()
  if (!conn.available) throw new BackendUnavailableError()
  const res = await fetch(`${conn.endpoint}/api/v1${path}`, {
    headers: authHeaders(conn.token),
    signal,
  })
  if (!res.ok) throw new Error(`backend ${path}: ${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

/** Send a JSON request (any method) to an endpoint under `/api/v1`. */
export async function backendRequest<T>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const conn = await resolveConnection()
  if (!conn.available) throw new BackendUnavailableError()
  const res = await fetch(`${conn.endpoint}/api/v1${path}`, {
    method,
    headers: {
      ...authHeaders(conn.token),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`backend ${path}: ${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

/** POST a JSON body to an endpoint under `/api/v1` and parse the JSON response. */
export function backendPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return backendRequest<T>('POST', path, body, signal)
}

/** POST a multipart form and parse a JSON response (e.g. PDF inspect). */
export async function backendUpload<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
  const conn = await resolveConnection()
  if (!conn.available) throw new BackendUnavailableError()
  const res = await fetch(`${conn.endpoint}/api/v1${path}`, {
    method: 'POST',
    headers: authHeaders(conn.token),
    body: form,
    signal,
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const j = (await res.json()) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      /* keep status text */
    }
    throw new Error(msg)
  }
  return (await res.json()) as T
}

/**
 * POST a multipart form and get the raw response body back (e.g. a transformed
 * PDF). On a non-2xx, the JSON `error` field is thrown as an `Error`.
 */
export async function backendUploadForBlob(
  path: string,
  form: FormData,
  signal?: AbortSignal,
): Promise<{ blob: Blob; headers: Headers }> {
  const conn = await resolveConnection()
  if (!conn.available) throw new BackendUnavailableError()
  const res = await fetch(`${conn.endpoint}/api/v1${path}`, {
    method: 'POST',
    headers: authHeaders(conn.token),
    body: form,
    signal,
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const j = (await res.json()) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      /* keep status text */
    }
    throw new Error(msg)
  }
  return { blob: await res.blob(), headers: res.headers }
}

/**
 * Build the URL for an SSE stream endpoint. `EventSource` cannot set an
 * Authorization header, so the token rides as a query param — acceptable on a
 * loopback connection. Callers pass this to `new EventSource(url)` or a
 * fetch-based reader.
 */
export async function backendStreamUrl(path: string, params?: Record<string, string>): Promise<string> {
  const conn = await resolveConnection()
  if (!conn.available) throw new BackendUnavailableError()
  const qs = new URLSearchParams(params)
  if (conn.token) qs.set('token', conn.token)
  const query = qs.toString()
  return `${conn.endpoint}/api/v1${path}${query ? `?${query}` : ''}`
}

/** Quick liveness probe used by the backend store. Short timeout, never throws for "down". */
export async function probeBackend(): Promise<HealthInfo | null> {
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 2500)
    try {
      return await backendGet<HealthInfo>('/health', controller.signal)
    } finally {
      clearTimeout(t)
    }
  } catch {
    return null
  }
}

export async function fetchCapabilities(): Promise<CapabilitiesInfo | null> {
  try {
    return await backendGet<CapabilitiesInfo>('/capabilities')
  } catch {
    return null
  }
}
