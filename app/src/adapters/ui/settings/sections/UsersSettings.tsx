import { useEffect, useState } from 'react'
import { Loader2, Plus, RotateCcw, Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import * as api from '@/adapters/backend/authClient'
import { reportError } from '@/stores/errorStore'
import { useAuthStore } from '@/stores/authStore'
import { ROLE_LABEL, type AuthUser, type Role } from '@/core/auth/authModel'
import { kModuleTaxonomy } from '@/adapters/ui/shell/moduleTaxonomy'
import { SettingsGroup } from '../SettingsScaffold'

const ROLES: Role[] = ['admin', 'operator', 'viewer']

export function UsersSettings() {
  const me = useAuthStore((s) => s.me)
  const [users, setUsers] = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<AuthUser | null>(null)

  async function refresh() {
    try {
      setUsers(await api.listUsers())
    } catch (e) {
      reportError(e, 'Users')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void refresh()
  }, [])

  async function patch(id: string, p: Parameters<typeof api.patchUser>[1]) {
    try {
      await api.patchUser(id, p)
      await refresh()
    } catch (e) {
      reportError(e, 'Users')
    }
  }
  async function remove(u: AuthUser) {
    if (!confirm(`Delete ${u.username}? This cannot be undone.`)) return
    try {
      await api.deleteUser(u.id)
      await refresh()
    } catch (e) {
      reportError(e, 'Users')
    }
  }

  return (
    <>
      <SettingsGroup
        title="Accounts"
        description="Everyone who can sign in to this backend. Roles: admin manages users, operator runs and edits, viewer is read-only."
      >
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <UserPlus className="size-4" /> New user
          </Button>
        </div>
        {loading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{u.username}</span>
                  {u.id === me?.id && <span className="ml-1 text-[10px] text-muted-foreground">(you)</span>}
                  {u.disabled && <span className="ml-1 text-[10px] text-destructive">disabled</span>}
                  <div className="text-[11px] text-muted-foreground">
                    {u.allowedModules ? `${u.allowedModules.length} modules` : 'all modules'}
                    {u.mustChangePw && ' · must change password'}
                  </div>
                </div>
                <Select value={u.role} onValueChange={(v) => v && patch(u.id, { role: v as Role })}>
                  <SelectTrigger size="sm" className="w-28">
                    <SelectValue>{() => ROLE_LABEL[u.role]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="xs" variant="ghost" onClick={() => setEditing(u)}>
                  Modules
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => patch(u.id, { disabled: !u.disabled })}
                  disabled={u.id === me?.id}
                >
                  {u.disabled ? 'Enable' : 'Disable'}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    const pw = prompt(`New password for ${u.username} (min 10 chars):`)
                    if (pw) void patch(u.id, { password: pw, mustChangePw: true })
                  }}
                >
                  <RotateCcw className="size-3.5" />
                </Button>
                <button
                  type="button"
                  aria-label={`Delete ${u.username}`}
                  className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                  disabled={u.id === me?.id}
                  onClick={() => void remove(u)}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsGroup>

      <CreateUserDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false)
          void refresh()
        }}
      />
      <ModuleAccessDialog
        user={editing}
        onClose={() => setEditing(null)}
        onSaved={(mods) => {
          if (editing) void patch(editing.id, { allowedModules: mods })
          setEditing(null)
        }}
      />
    </>
  )
}

function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('operator')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    setBusy(true)
    setErr('')
    try {
      await api.createUser({ username: username.trim(), password, role })
      setUsername('')
      setPassword('')
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the user')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <Label className="text-xs">Username</Label>
            <Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <Label className="text-xs">Temporary password (min 10)</Label>
            <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <Select value={role} onValueChange={(v) => v && setRole(v as Role)}>
              <SelectTrigger size="sm">
                <SelectValue>{() => ROLE_LABEL[role]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {err && <p className="text-xs text-destructive">{err}</p>}
          <Button onClick={() => void submit()} disabled={busy || !username.trim() || password.length < 10}>
            <Plus className="size-4" /> Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ModuleAccessDialog({
  user,
  onClose,
  onSaved,
}: {
  user: AuthUser | null
  onClose: () => void
  onSaved: (mods: string[] | null) => void
}) {
  const [all, setAll] = useState(true)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (user) {
      setAll(!user.allowedModules)
      setPicked(new Set(user.allowedModules ?? []))
    }
  }, [user])

  if (!user) return null

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{user.username} — module access</DialogTitle>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-3.5 accent-primary" checked={all} onChange={(e) => setAll(e.target.checked)} />
          All modules
        </label>
        {!all && (
          <div className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto">
            {kModuleTaxonomy.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={picked.has(m.id)}
                  onChange={(e) => {
                    const n = new Set(picked)
                    if (e.target.checked) n.add(m.id)
                    else n.delete(m.id)
                    setPicked(n)
                  }}
                />
                {m.title}
              </label>
            ))}
          </div>
        )}
        <Button className="mt-3" onClick={() => onSaved(all ? null : [...picked])}>
          Save
        </Button>
      </DialogContent>
    </Dialog>
  )
}
