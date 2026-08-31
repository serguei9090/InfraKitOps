/**
 * Shown while a code-split route chunk loads (CODE_SPLITTING_PLAN.md).
 *
 * - `RouteFallback` — the root route's `HydrateFallback`: a cold deep-link to a
 *   lazy route has no previous screen to hold, so fill the pane with a neutral
 *   skeleton for the ~1 frame the chunk takes on localhost / a bit longer on a
 *   slow network.
 * - `RoutePendingBar` — during an in-app navigation React Router keeps the
 *   current screen mounted until the next chunk resolves, so all that's needed
 *   is a thin top progress hint.
 */
import { useNavigation } from 'react-router-dom'

export function RouteFallback() {
  return (
    <div className="flex h-full w-full flex-col gap-4 p-6" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
      <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="animate-pulse rounded-lg bg-muted/60" />
        <div className="animate-pulse rounded-lg bg-muted/40" />
      </div>
    </div>
  )
}

export function RoutePendingBar() {
  const nav = useNavigation()
  if (nav.state === 'idle') return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
      <div className="h-full w-1/3 animate-[route-bar_1s_ease-in-out_infinite] bg-primary" />
      <style>{`@keyframes route-bar{0%{margin-left:-33%}100%{margin-left:100%}}`}</style>
    </div>
  )
}
