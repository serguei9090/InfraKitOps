/**
 * CS3 — warm a code-split route chunk before the user commits to navigating
 * (rail icon / tool card hover + focus). React Router keeps the previous
 * screen mounted until the next route's `lazy:` resolves, so pre-firing the
 * import on hover removes the visible wait on the click.
 *
 * The `routes ⇢ shell ⇢ sidebar ⇢ prefetchRoute ⇢ routes` import cycle is
 * safe here: `router` is only dereferenced inside `prefetchRoute`, long after
 * every module in the cycle has finished evaluating (ESM live bindings).
 */
import { matchRoutes } from 'react-router-dom'
import { router } from '@/routes'

const warmed = new Set<string>()

export function prefetchRoute(pathname: string): void {
  if (!pathname || pathname === '/' || warmed.has(pathname)) return
  warmed.add(pathname)
  const matches = matchRoutes(router.routes, pathname) ?? []
  for (const { route } of matches) {
    const lazy = (route as { lazy?: unknown }).lazy
    if (typeof lazy === 'function') {
      void (lazy as () => Promise<unknown>)()
    }
  }
}
