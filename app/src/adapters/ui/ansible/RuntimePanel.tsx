import { useState } from 'react'
import { CheckCircle2, Cpu, FolderCog, Loader2, PackagePlus, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAnsibleStore } from '@/stores/ansibleStore'
import { useAuthStore } from '@/stores/authStore'
import type { RuntimeMode } from '@/core/ansible/ansibleModel'

const MODE_HINT: Record<RuntimeMode, string> = {
  auto: 'Use your system ansible if present, otherwise the InfraKit-managed one',
  system: 'Always use the ansible binaries on your PATH',
  managed: 'Always use the InfraKit-managed uv virtualenv',
}

/**
 * First-open configuration for the Ansible module: the workspace folder (where
 * `New project` scaffolds go) and the runtime (system / managed uv venv).
 * Admin-gated in multi-user mode. See ANSIBLE_MODULE_PLAN.md AN0.
 */
export function RuntimePanel() {
  const settings = useAnsibleStore((s) => s.settings)
  const save = useAnsibleStore((s) => s.saveSettings)
  const setupManaged = useAnsibleStore((s) => s.setupManaged)
  const busySetup = useAnsibleStore((s) => s.busySetup)
  const setupLog = useAnsibleStore((s) => s.setupLog)
  const isAdmin = useAuthStore((s) => s.mode === 'off' || s.me?.role === 'admin')

  const [dir, setDir] = useState(settings?.workspaceDir ?? '')
  if (!settings) return null
  const caps = settings.capabilities
  const active = caps.active['ansible-playbook']

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FolderCog className="size-4" /> Workspace folder
        </h2>
        <p className="text-sm text-muted-foreground">
          Where <code className="text-xs">New project</code> creates a fresh playbook/roles/inventory
          layout. Existing projects can live anywhere.
        </p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save({ workspaceDir: dir.trim() })
        }}
      >
        <Input
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder={settings.defaultWorkspace}
          disabled={!isAdmin}
        />
        <Button type="submit" disabled={!isAdmin || dir.trim() === (settings.workspaceDir ?? '')}>
          Save
        </Button>
      </form>

      <div className="space-y-1 pt-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Cpu className="size-4" /> Runtime
        </h2>
        <p className="text-sm text-muted-foreground">Which ansible install the module runs playbooks with.</p>
      </div>

      <div className="flex items-center gap-3">
        <Select
          value={settings.runtime}
          onValueChange={(v) => v && isAdmin && void save({ runtime: v })}
        >
          <SelectTrigger className="w-40" disabled={!isAdmin}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['auto', 'system', 'managed'] as RuntimeMode[]).map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{MODE_HINT[settings.runtime]}</span>
      </div>

      <div className="rounded-lg border border-border/60 p-3 text-sm">
        <div className="flex items-center gap-2">
          {caps.ready ? (
            <CheckCircle2 className="size-4 text-emerald-500" />
          ) : (
            <XCircle className="size-4 text-red-500" />
          )}
          <span className="font-medium">
            {caps.ready ? `ansible ready — ${active?.version ?? active?.path}` : 'ansible not available'}
          </span>
        </div>
        {!caps.ready && caps.reason && (
          <p className="mt-1 text-xs text-muted-foreground">{caps.reason}</p>
        )}
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 font-mono text-xs text-muted-foreground">
          <span>system: {caps.system['ansible-playbook']?.found ? 'yes' : 'no'}</span>
          <span>managed: {caps.managed['ansible-playbook']?.found ? 'yes' : 'no'}</span>
          <span>uv: {caps.uv.found ? caps.uv.version ?? 'yes' : 'no'}</span>
          <span className="truncate">venv: {caps.venvPath}</span>
        </div>

        {isAdmin && caps.uv.found && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={busySetup}
            onClick={() => setupManaged()}
          >
            {busySetup ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
            {caps.managed['ansible-playbook']?.found ? 'Reinstall managed ansible' : 'Set up managed ansible'}
          </Button>
        )}
        {setupLog.length > 0 && (
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">
            {setupLog.join('\n')}
          </pre>
        )}
      </div>
    </div>
  )
}
