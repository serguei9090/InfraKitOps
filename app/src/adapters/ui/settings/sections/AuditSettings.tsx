import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import * as api from '@/adapters/backend/authClient'
import { reportError } from '@/stores/errorStore'
import type { AuditEntry } from '@/core/auth/authModel'
import { SettingsGroup } from '../SettingsScaffold'

const ACTION_LABEL: Record<string, string> = {
  login: 'signed in',
  login_failed: 'failed sign-in',
  logout: 'signed out',
  bootstrap: 'created the first admin',
  password_change: 'changed password',
  user_create: 'created user',
  user_update: 'updated user',
  user_delete: 'deleted user',
  vault_unlock: 'unlocked the vault',
  vault_secret_write: 'wrote a vault secret',
  llm_connection_write: 'saved an AI connection',
  runbook_run: 'ran a runbook',
  runbook_run_approve: 'approved a run',
  runbook_run_deny: 'denied a run',
}

export function AuditSettings() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      setEntries(await api.listAudit(300))
    } catch (e) {
      reportError(e, 'Audit')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  return (
    <SettingsGroup
      title="Audit log"
      description="Append-only record of sign-ins, user changes, vault unlocks, secret writes, AI-connection edits and runbook runs / approvals."
    >
      <div className="mb-2 flex justify-end">
        <Button size="xs" variant="ghost" onClick={() => void load()}>
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      ) : entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-border/50 overflow-y-auto text-sm">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
              <span className="w-36 shrink-0 text-xs text-muted-foreground">
                {new Date(e.at).toLocaleString()}
              </span>
              <span className="font-medium">{e.actor || '—'}</span>
              <span className="text-muted-foreground">{ACTION_LABEL[e.action] ?? e.action}</span>
              {e.target && <span className="font-mono text-xs">{e.target}</span>}
              {e.meta && e.meta !== '{}' && e.meta !== 'null' && (
                <span className="font-mono text-[11px] text-muted-foreground">{e.meta}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsGroup>
  )
}
