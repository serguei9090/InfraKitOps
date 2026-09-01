import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './routes'
import { useAuthStore } from './stores/authStore'
import { AuthGate, ForcedPasswordChange } from './adapters/ui/auth/AuthGate'

function App() {
  const ready = useAuthStore((s) => s.ready)
  const mode = useAuthStore((s) => s.mode)
  const me = useAuthStore((s) => s.me)
  const init = useAuthStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  // Until the /health probe resolves we don't know whether to gate — a brief
  // blank is fine (the same window the router's HydrateFallback would show).
  if (!ready) return null

  if (mode === 'on' && !me) return <AuthGate />
  if (mode === 'on' && me?.mustChangePw) return <ForcedPasswordChange />

  return <RouterProvider router={router} />
}

export default App
