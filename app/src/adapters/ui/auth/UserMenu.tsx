import { useState } from 'react'
import { LogOut, ShieldCheck, User as UserIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/authStore'
import { ROLE_LABEL } from '@/core/auth/authModel'

/** Top-bar account control — only rendered in multi-user mode. */
export function UserMenu() {
  const me = useAuthStore((s) => s.me)
  const logout = useAuthStore((s) => s.logout)
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState(false)

  if (!me) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-[10px] px-2 py-1.5 text-xs hover:bg-accent/40"
        aria-label="Account"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
          {me.username.slice(0, 2).toUpperCase()}
        </span>
        <span className="hidden sm:block">{me.username}</span>
      </button>

      {open && (
        <div
          className="absolute right-4 top-14 z-50 w-56 rounded-lg border border-border/60 bg-popover p-1.5 text-sm shadow-md"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="px-2 py-1.5">
            <div className="flex items-center gap-1.5 font-medium">
              <UserIcon className="size-3.5" /> {me.username}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {me.role === 'admin' && <ShieldCheck className="size-3" />}
              {ROLE_LABEL[me.role]}
              {me.allowedModules && ` · ${me.allowedModules.length} modules`}
            </div>
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/40"
            onClick={() => {
              setOpen(false)
              setPw(true)
            }}
          >
            Change password
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
            onClick={() => void logout()}
          >
            <LogOut className="size-3.5" /> Sign out
          </button>
        </div>
      )}

      <ChangePasswordDialog open={pw} onClose={() => setPw(false)} />
    </>
  )
}

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const changePassword = useAuthStore((s) => s.changePassword)
  const busy = useAuthStore((s) => s.busy)
  const error = useAuthStore((s) => s.error)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  const weak = next.length > 0 && next.length < 10
  const mismatch = confirm.length > 0 && next !== confirm

  async function submit() {
    if (weak || mismatch) return
    if (await changePassword(current, next)) {
      setCurrent('')
      setNext('')
      setConfirm('')
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <Label className="text-xs">Current password</Label>
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </div>
          <div>
            <Label className="text-xs">New password (min 10)</Label>
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </div>
          <div>
            <Label className="text-xs">Confirm</Label>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </div>
          {weak && <p className="text-xs text-destructive">At least 10 characters.</p>}
          {mismatch && <p className="text-xs text-destructive">Passwords don&rsquo;t match.</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button onClick={() => void submit()} disabled={busy || !current || weak || mismatch || !next}>
            Update password
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
