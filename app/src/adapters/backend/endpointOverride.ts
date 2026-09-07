/**
 * S3f — web-build backend endpoint override.
 *
 * The desktop app discovers the sidecar's address at runtime. The static web
 * build normally bakes the address in at build time (`VITE_BACKEND_URL` /
 * `VITE_BACKEND_TOKEN`), so a hosted deployment can only ever reach the one
 * backend it was built against. This lets a user point the running web app at
 * their own backend without a rebuild: a URL + per-launch token kept in
 * `localStorage`, which wins over the build-time env vars.
 *
 * Not used on desktop (Tauri) — the sidecar path is authoritative there.
 * See SETTINGS_MODULE_PLAN.md §S3 and PACKAGING_PLAN.md P7f.
 */

import { DEMO_MODE } from '@/lib/demoMode'

const KEY = 'infrakit:backend-endpoint'

export interface EndpointOverride {
  url: string
  token: string
}

const trimUrl = (u: string) => u.trim().replace(/\/+$/, '')

/** The stored override, or null if none / unreadable / malformed. */
export function readEndpointOverride(): EndpointOverride | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as Partial<EndpointOverride>
    const url = typeof o.url === 'string' ? trimUrl(o.url) : ''
    if (!url) return null
    return { url, token: typeof o.token === 'string' ? o.token : '' }
  } catch {
    return null
  }
}

/** Save an override, or clear it when `o` is null or has a blank URL. */
export function writeEndpointOverride(o: EndpointOverride | null): void {
  try {
    if (o && trimUrl(o.url)) {
      localStorage.setItem(KEY, JSON.stringify({ url: trimUrl(o.url), token: o.token.trim() }))
    } else {
      localStorage.removeItem(KEY)
    }
  } catch {
    /* private mode / storage disabled — silently no-op */
  }
}

export interface ResolvedEndpoint {
  endpoint: string
  token: string
  available: boolean
}

/**
 * Resolve the web build's backend endpoint: the localStorage override first,
 * then the build-time env vars, then "unavailable".
 */
export function resolveWebEndpoint(): ResolvedEndpoint {
  const ov = readEndpointOverride()
  if (ov) return { endpoint: ov.url, token: ov.token, available: true }
  // The public demo build never auto-connects to a baked-in backend — a
  // visitor opts in with an explicit endpoint override (handled above).
  if (DEMO_MODE) return { endpoint: '', token: '', available: false }
  const url = trimUrl((import.meta.env.VITE_BACKEND_URL as string | undefined) ?? '')
  const token = (import.meta.env.VITE_BACKEND_TOKEN as string | undefined) ?? ''
  return { endpoint: url, token, available: url.length > 0 }
}
