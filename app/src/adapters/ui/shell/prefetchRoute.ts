/**
 * CS3 — warm a code-split route chunk before the user commits to navigating
 * (rail icon / tool card hover + focus). React Router keeps the previous
 * screen mounted until the next route's `lazy:` resolves, so pre-firing the
 * import on hover removes the visible wait on the click.
 *
 * `@/routes` is imported dynamically (it's already in the entry chunk, so this
 * resolves from cache) to stay clear of the routes ⇢ shell ⇢ sidebar import
 * cycle.
 */
import { matchRoutes } from 'react-router-dom'

const warmed = new Set<string>()

export function prefetchRoute(pathname: string): void {
  if (!pathname || pathname === '/' || warmed.has(pathname)) return
  warmed.add(pathname)
  void import('@/routes').then(({ router }) => {
    const matches = matchRoutes(router.routes, pathname) ?? []
    for (const { route } of matches) {
      const lazy = (route as { lazy?: unknown }).lazy
      if (typeof lazy === 'function') {
        void (lazy as () => Promise<unknown>)()
      }
    }
  })
}
