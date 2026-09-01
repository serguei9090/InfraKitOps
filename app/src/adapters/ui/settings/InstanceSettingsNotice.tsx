import { Lock } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'

/**
 * Shown above instance-wide settings sections (AI defaults, Runbook execution
 * policy) when the caller is a non-admin in multi-user mode — the backend
 * refuses the write, so flag it up front. Renders nothing in single-user mode
 * or for an admin.
 */
export function InstanceSettingsNotice() {
  const locked = useAuthStore((s) => s.mode === 'on' && s.me?.role !== 'admin')
  if (!locked) return null
  return (
    <div className="mb-4 flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <Lock className="size-3.5 shrink-0" />
      These are instance-wide settings — only an administrator can change them.
    </div>
  )
}
