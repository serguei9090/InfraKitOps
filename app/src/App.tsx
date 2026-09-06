import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './routes'
import { useAuthStore } from './stores/authStore'
import { useBackendStore } from './stores/backendStore'
import { useRunsStore } from './stores/runsStore'
import { AuthGate, ForcedPasswordChange } from './adapters/ui/auth/AuthGate'
import { ErrorBoundary } from './adapters/ui/errors/ErrorBoundary'
import { syncKeepAliveOnBoot } from './adapters/backend/desktopKeepAlive'

function App() {
  const ready = useAuthStore((s) => s.ready)
  const mode = useAuthStore((s) => s.mode)
  const me = useAuthStore((s) => s.me)
  const init = useAuthStore((s) => s.init)
  const startAutoConnect = useBackendStore((s) => s.startAutoConnect)
  const startRunsPolling = useRunsStore((s) => s.startPolling)

  useEffect(() => {
    void init()
  }, [init])

  // Self-healing backend connect loop: covers the desktop sidecar's warm-up
  // race and reconnects after a backend restart without a manual Retry click.
  useEffect(() => {
    startAutoConnect()
  }, [startAutoConnect])

  // Track server-side background runs so the global Runs drawer stays current
  // even when no run screen is mounted (BACKGROUND_RUNS_PLAN.md).
  useEffect(() => {
    startRunsPolling()
    void syncKeepAliveOnBoot()
  }, [startRunsPolling])

  // Until the /health probe resolves we don't know whether to gate — a brief
  // blank is fine (the same window the router's HydrateFallback would show).
  if (!ready) return null

  if (mode === 'on' && !me) return <AuthGate />
  if (mode === 'on' && me?.mustChangePw) return <ForcedPasswordChange />

  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  )
}

export default App
