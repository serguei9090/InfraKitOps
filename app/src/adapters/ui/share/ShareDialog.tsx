import { Loader2, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  listShares,
  pickUsers,
  putShare,
  reassignOwner,
  removeShare,
  type PickUser,
  type ShareGrant,
} from '@/adapters/backend/shareClient'
import { useAuthStore } from '@/stores/authStore'
import { reportError } from '@/stores/errorStore'

interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Resource path, e.g. `/runbooks/rb_1`. */
  base: string
  /** Human label for the sentence ("Share this runbook with…"). */
  noun: string
  title: string
}

/** Owner-only dialog to grant / revoke per-user access to one item. */
export function ShareDialog({ open, onOpenChange, base, noun, title }: ShareDialogProps) {
  const me = useAuthStore((s) => s.me)
  const [grants, setGrants] = useState<ShareGrant[]>([])
  const [users, setUsers] = useState<PickUser[]>([])
  const [busy, setBusy] = useState(false)
  const [addId, setAddId] = useState('')
  const [addEdit, setAddEdit] = useState(false)
  const [reassignId, setReassignId] = useState('')
  const isAdmin = me?.role === 'admin'

  useEffect(() => {
    if (!open) return
    setBusy(true)
    Promise.all([listShares(base), pickUsers()])
      .then(([g, u]) => {
        setGrants(g)
        setUsers(u)
      })
      .catch((e) => reportError(e, 'Sharing'))
      .finally(() => setBusy(false))
  }, [open, base])

  const nameOf = useMemo(() => {
    const m = new Map(users.map((u) => [u.id, u.username]))
    return (id: string) => m.get(id) ?? id
  }, [users])

  const grantable = useMemo(() => {
    const taken = new Set(grants.map((g) => g.granteeId))
    return users.filter((u) => u.id !== me?.id && !taken.has(u.id))
  }, [users, grants, me])

  async function run<T>(p: Promise<T>) {
    setBusy(true)
    try {
      return await p
    } catch (e) {
      reportError(e, 'Sharing')
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    if (!addId) return
    const next = await run(putShare(base, addId, addEdit))
    if (next) {
      setGrants(next)
      setAddId('')
      setAddEdit(false)
    }
  }
  async function toggleEdit(g: ShareGrant) {
    const next = await run(putShare(base, g.granteeId, !g.canEdit))
    if (next) setGrants(next)
  }
  async function revoke(g: ShareGrant) {
    const next = await run(removeShare(base, g.granteeId))
    if (next) setGrants(next)
  }
  async function doReassign() {
    if (!reassignId) return
    const r = await run(reassignOwner(base, reassignId))
    if (r) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          People you add can view and run this {noun}. Give <em>Can edit</em> to also let
          them change it. Only you (the owner) manage sharing.
        </p>

        {/* current grants */}
        <div className="flex flex-col gap-1">
          {grants.length === 0 && !busy && (
            <p className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
              Not shared with anyone yet.
            </p>
          )}
          {grants.map((g) => (
            <div
              key={g.granteeId}
              className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{nameOf(g.granteeId)}</span>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox checked={g.canEdit} onCheckedChange={() => void toggleEdit(g)} />
                Can edit
              </label>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${nameOf(g.granteeId)}`}
                onClick={() => void revoke(g)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>

        {/* add row */}
        <div className="flex items-center gap-2 border-t border-border/60 pt-3">
          <Select
            value={addId}
            onValueChange={(v) => setAddId(v ?? '')}
            disabled={grantable.length === 0}
          >
            <SelectTrigger size="sm" className="flex-1">
              <SelectValue placeholder={grantable.length ? 'Add a person…' : 'Everyone already added'}>
                {(v) => (v ? nameOf(String(v)) : 'Add a person…')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {grantable.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox checked={addEdit} onCheckedChange={(v) => setAddEdit(v === true)} />
            Can edit
          </label>
          <Button size="sm" disabled={!addId || busy} onClick={() => void add()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
            Add
          </Button>
        </div>

        {isAdmin && (
          <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-500">
              Admin — reassign owner
            </p>
            <p className="text-[11px] text-muted-foreground">
              Hand this {noun} to another user (e.g. when someone leaves). Audited. You
              lose access unless it&apos;s also shared with you.
            </p>
            <div className="flex items-center gap-2">
              <Select value={reassignId} onValueChange={(v) => setReassignId(v ?? '')}>
                <SelectTrigger size="sm" className="flex-1">
                  <SelectValue placeholder="New owner…">
                    {(v) => (v ? nameOf(String(v)) : 'New owner…')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {users
                    .filter((u) => u.id !== me?.id)
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.username}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                disabled={!reassignId || busy}
                onClick={() => void doReassign()}
              >
                Reassign
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Done</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
