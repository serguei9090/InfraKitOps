import { useEffect, useState } from 'react'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/authStore'

/**
 * Full-screen sign-in / first-run setup, shown by AppShellScaffold whenever
 * the backend is in multi-user mode and nobody is signed in.
 */
export function AuthGate() {
  const needsBootstrap = useAuthStore((s) => s.needsBootstrap)
  return needsBootstrap ? <SetupForm /> : <LoginForm />
}

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-primary to-primary/60">
            <span className="text-sm font-bold text-primary-foreground">IK</span>
          </div>
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-xs text-muted-foreground">{subtitle}</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function LoginForm() {
  const login = useAuthStore((s) => s.login)
  const busy = useAuthStore((s) => s.busy)
  const error = useAuthStore((s) => s.error)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  return (
    <Shell title="InfraKit Studio" subtitle="Sign in to continue">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void login(username.trim(), password)
        }}
      >
        <div>
          <Label htmlFor="u" className="text-xs">
            Username
          </Label>
          <Input id="u" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </div>
        <div>
          <Label htmlFor="p" className="text-xs">
            Password
          </Label>
          <Input
            id="p"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" disabled={busy || !username.trim() || !password} className="mt-1">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          Sign in
        </Button>
      </form>
    </Shell>
  )
}

function SetupForm() {
  const bootstrapAdmin = useAuthStore((s) => s.bootstrapAdmin)
  const busy = useAuthStore((s) => s.busy)
  const error = useAuthStore((s) => s.error)
  const [token, setToken] = useState('')
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const mismatch = confirm.length > 0 && password !== confirm
  const weak = password.length > 0 && password.length < 10

  useEffect(() => {
    // Convenience: the backend may be reachable with the token on the URL as
    // ?setup=... — pre-fill it so an operator doesn't have to copy it twice.
    const p = new URLSearchParams(window.location.search).get('setup')
    if (p) setToken(p)
  }, [])

  return (
    <Shell title="First-run setup" subtitle="Create the first administrator">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (mismatch || weak) return
          void bootstrapAdmin(token.trim(), username.trim(), password)
        }}
      >
        <div>
          <Label htmlFor="t" className="text-xs">
            Setup token
          </Label>
          <Input
            id="t"
            autoFocus
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="printed in the backend log as SETUP-TOKEN"
            className="font-mono text-xs"
          />
        </div>
        <div>
          <Label htmlFor="su" className="text-xs">
            Admin username
          </Label>
          <Input id="su" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </div>
        <div>
          <Label htmlFor="sp" className="text-xs">
            Password <span className="text-muted-foreground">(min 10 characters)</span>
          </Label>
          <Input
            id="sp"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div>
          <Label htmlFor="sc" className="text-xs">
            Confirm password
          </Label>
          <Input
            id="sc"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        {weak && <p className="text-xs text-destructive">Password must be at least 10 characters.</p>}
        {mismatch && <p className="text-xs text-destructive">Passwords don&rsquo;t match.</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button
          type="submit"
          disabled={busy || !token.trim() || !username.trim() || weak || mismatch || !password}
          className="mt-1"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          Create admin &amp; sign in
        </Button>
      </form>
    </Shell>
  )
}
