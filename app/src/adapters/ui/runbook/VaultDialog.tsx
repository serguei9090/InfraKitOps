import { KeyRound, Lock, LockOpen, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useVaultStore } from '@/stores/vaultStore'

const KINDS = ['password', 'api-key', 'token', 'ssh-key', 'kubeconfig', 'certificate', 'other']

export function VaultDialog() {
  const status = useVaultStore((s) => s.status)
  const secrets = useVaultStore((s) => s.secrets)
  const error = useVaultStore((s) => s.error)
  const init = useVaultStore((s) => s.init)
  const unlock = useVaultStore((s) => s.unlock)
  const unlockWithKeyring = useVaultStore((s) => s.unlockWithKeyring)
  const remember = useVaultStore((s) => s.remember)
  const forget = useVaultStore((s) => s.forget)
  const lock = useVaultStore((s) => s.lock)
  const putSecret = useVaultStore((s) => s.putSecret)
  const deleteSecret = useVaultStore((s) => s.deleteSecret)

  const [pw, setPw] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', kind: 'password', notes: '', value: '' })

  const unlocked = status?.unlocked ?? false
  const initialised = status?.initialised ?? false

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            {unlocked ? <LockOpen className="size-4 text-emerald-500" /> : <Lock className="size-4" />}
            Vault
          </Button>
        }
      />
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Vault</DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!initialised ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await init(pw)) setPw('')
            }}
          >
            <Label htmlFor="v-init">Set a master password (min 8 chars)</Label>
            <Input id="v-init" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            <p className="text-xs text-muted-foreground">
              It is never stored. Lose it and the secrets are unrecoverable.
            </p>
            <Button type="submit" disabled={pw.length < 8}>
              Create vault
            </Button>
          </form>
        ) : !unlocked ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await unlock(pw)) setPw('')
            }}
          >
            <Label htmlFor="v-unlock">Master password</Label>
            <Input id="v-unlock" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            <Button type="submit" disabled={!pw}>
              Unlock
            </Button>
            {status?.keyringRemembered && (
              <Button type="button" variant="outline" onClick={() => void unlockWithKeyring()}>
                <KeyRound className="size-4" /> Unlock with device keyring
              </Button>
            )}
          </form>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {secrets.length} secret{secrets.length === 1 ? '' : 's'} · auto-locks in{' '}
                {Math.round((status?.autoLockInSec ?? 0) / 60)} min
              </span>
              <div className="flex gap-1.5">
                <Button size="xs" variant="outline" onClick={() => setAdding((v) => !v)}>
                  <Plus className="size-3.5" /> Add
                </Button>
                <Button size="xs" variant="ghost" onClick={() => void lock()}>
                  <Lock className="size-3.5" /> Lock
                </Button>
              </div>
            </div>

            {status?.keyringAvailable && (
              <label className="flex items-center gap-2 rounded-md bg-accent/30 px-2 py-1.5 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={status.keyringRemembered}
                  onChange={(e) => void (e.target.checked ? remember() : forget())}
                />
                Remember the key on this device (auto-unlock after a restart, via the OS keyring)
              </label>
            )}

            {adding && (
              <form
                className="flex flex-col gap-2 rounded-lg border border-border/60 p-3"
                onSubmit={async (e) => {
                  e.preventDefault()
                  await putSecret(draft)
                  setDraft({ name: '', kind: 'password', notes: '', value: '' })
                  setAdding(false)
                }}
              >
                <Input
                  placeholder="Name (referenced as {{secret:NAME}})"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Select value={draft.kind} onValueChange={(v) => v && setDraft((d) => ({ ...d, kind: v }))}>
                    <SelectTrigger size="sm" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {k}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="flex-1"
                    placeholder="Notes (optional)"
                    value={draft.notes}
                    onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                  />
                </div>
                <Input
                  type="password"
                  placeholder="Secret value"
                  value={draft.value}
                  onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
                />
                <Button type="submit" size="sm" disabled={!draft.name || !draft.value}>
                  Save secret
                </Button>
              </form>
            )}

            <ul className="min-h-0 flex-1 overflow-y-auto">
              {secrets.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40">
                  <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="font-mono text-xs">{s.name}</span>
                  <span className="text-[11px] text-muted-foreground">{s.kind}</span>
                  <div className="flex-1" />
                  <button
                    type="button"
                    aria-label={`Delete ${s.name}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void deleteSecret(s.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
              {secrets.length === 0 && (
                <li className="px-2 py-6 text-center text-xs text-muted-foreground">No secrets yet.</li>
              )}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
