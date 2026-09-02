import { useEffect, useState } from 'react'
import {
  Boxes,
  CheckCircle2,
  Container,
  Cpu,
  ExternalLink,
  FolderCog,
  Hammer,
  Loader2,
  PackagePlus,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import * as api from '@/adapters/backend/ansibleClient'
import { useAnsibleStore } from '@/stores/ansibleStore'
import { useAuthStore } from '@/stores/authStore'
import type { AnsibleSettings, RunnerStatus } from '@/core/ansible/ansibleModel'

const MODE_HINT: Record<string, string> = {
  auto: 'Pick the first that works: system → managed → container',
  system: 'The ansible binaries on your PATH (Linux/macOS)',
  managed: 'An InfraKit-managed uv virtualenv (Linux/macOS)',
  container: 'Run ansible inside a Docker / Podman container — works on Windows',
}

const MODE_ICON: Record<string, typeof Cpu> = {
  auto: Cpu,
  system: Terminal,
  managed: PackagePlus,
  container: Container,
}

/**
 * Workspace folder + execution backend chooser (AN6). Modes: system / managed
 * (local) · container (docker/podman, the Windows path). Admin-gated in
 * multi-user mode. See ANSIBLE_RUNTIME_PLAN.md.
 */
export function RuntimePanel() {
  const settings = useAnsibleStore((s) => s.settings)
  const save = useAnsibleStore((s) => s.saveSettings)
  const setupRuntime = useAnsibleStore((s) => s.setupRuntime)
  const busySetup = useAnsibleStore((s) => s.busySetup)
  const setupLog = useAnsibleStore((s) => s.setupLog)
  const refreshSettings = useAnsibleStore((s) => s.refreshSettings)
  const isAdmin = useAuthStore((s) => s.mode === 'off' || s.me?.role === 'admin')

  const [dir, setDir] = useState(settings?.workspaceDir ?? '')
  if (!settings) return null

  const runners = settings.runners ?? {}
  const modes: string[] = ['auto', 'system', 'managed', 'container']

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      {/* workspace */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FolderCog className="size-4" /> Workspace folder
        </h2>
        <p className="text-sm text-muted-foreground">
          Where <code className="text-xs">New project</code> scaffolds go. Existing / git projects can live
          anywhere.
        </p>
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
      </section>

      {/* runtime */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Cpu className="size-4" /> Execution backend
        </h2>
        <p className="text-sm text-muted-foreground">
          How the module runs ansible.
          {settings.os === 'windows' && (
            <> Ansible's control node doesn't run on native Windows — use <b>container</b> (Docker / Podman).</>
          )}
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          {modes.map((m) => {
            const Icon = MODE_ICON[m] ?? Cpu
            const st = runners[m]
            const selected = settings.runtime === m
            const ok = m === 'auto' ? Object.values(runners).some((r) => r.ready) : st?.ready
            return (
              <button
                key={m}
                type="button"
                disabled={!isAdmin}
                onClick={() => isAdmin && void save({ runtime: m })}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left',
                  selected ? 'border-primary bg-primary/5' : 'border-border/60 hover:bg-accent/30',
                )}
              >
                <div className="flex w-full items-center gap-2">
                  <Icon className="size-4" />
                  <span className="text-sm font-medium capitalize">{m}</span>
                  <span className="flex-1" />
                  {m !== 'auto' &&
                    (ok ? (
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                    ) : (
                      <XCircle className="size-3.5 text-muted-foreground" />
                    ))}
                </div>
                <span className="text-xs text-muted-foreground">{MODE_HINT[m]}</span>
                {st && !st.ready && st.reason && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400">{st.reason}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* per-mode setup */}
        {settings.runtime === 'managed' && (
          <ManagedSetup ready={runners.managed?.ready} busy={busySetup} onSetup={() => setupRuntime('managed')} admin={isAdmin} />
        )}
        {settings.runtime === 'container' && (
          <ContainerSetup
            settings={settings}
            status={runners.container}
            busy={busySetup}
            admin={isAdmin}
            onBuild={() => setupRuntime('container')}
            onTeardown={async () => {
              await api.teardownRuntime('container')
              void refreshSettings()
            }}
            onSave={(patch) => void save(patch)}
          />
        )}

        {/* install links */}
        {settings.os === 'windows' && !runners.container?.engine && (
          <div className="rounded-lg border border-border/60 p-3 text-sm">
            <p className="mb-2 text-muted-foreground">No container engine detected. Install one:</p>
            <div className="flex gap-2">
              {(['docker', 'podman'] as const).map((t) => (
                <a
                  key={t}
                  href={settings.install?.[t]}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-xs hover:bg-accent/40"
                >
                  {t} <ExternalLink className="size-3" />
                </a>
              ))}
            </div>
          </div>
        )}

        {setupLog.length > 0 && (
          <pre className="max-h-56 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">
            {setupLog.join('\n')}
          </pre>
        )}
      </section>
    </div>
  )
}

function ManagedSetup({
  ready,
  busy,
  admin,
  onSetup,
}: {
  ready?: boolean
  busy: boolean
  admin: boolean
  onSetup: () => void
}) {
  if (!admin) return null
  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={onSetup}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
      {ready ? 'Reinstall managed ansible' : 'Set up managed ansible (uv)'}
    </Button>
  )
}

function ContainerSetup({
  settings,
  status,
  busy,
  admin,
  onBuild,
  onTeardown,
  onSave,
}: {
  settings: AnsibleSettings
  status?: RunnerStatus
  busy: boolean
  admin: boolean
  onBuild: () => void
  onTeardown: () => void
  onSave: (patch: Parameters<typeof api.putSettings>[0]) => void
}) {
  const [image, setImage] = useState(settings.containerImage)
  const [pip, setPip] = useState(settings.controlNodePipPackages)
  const [colls, setColls] = useState(settings.controlNodeCollections)
  useEffect(() => {
    setImage(settings.containerImage)
    setPip(settings.controlNodePipPackages)
    setColls(settings.controlNodeCollections)
  }, [settings])

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-3 text-sm">
      <div className="flex items-center gap-2">
        {status?.ready ? (
          <CheckCircle2 className="size-4 text-emerald-500" />
        ) : (
          <XCircle className="size-4 text-muted-foreground" />
        )}
        <span className="font-medium">
          {status?.engine
            ? `${status.engine} ${status.engineVersion ?? ''}${status.daemonRunning ? '' : ' (daemon down)'}`
            : 'no docker / podman'}
        </span>
        {status?.ansibleVersion && (
          <span className="text-xs text-muted-foreground">· {status.ansibleVersion}</span>
        )}
      </div>
      {status && !status.ready && status.reason && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{status.reason}</p>
      )}

      {admin && (
        <>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Image (default builds one locally)</label>
            <div className="flex gap-2">
              <Input
                className="h-8 font-mono text-xs"
                value={image}
                onChange={(e) => setImage(e.target.value)}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={image === settings.containerImage}
                onClick={() => onSave({ containerImage: image })}
              >
                Set
              </Button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <PackagePlus className="size-3" /> Control-node pip packages
              </label>
              <Textarea
                className="font-mono text-[11px]"
                rows={2}
                placeholder="boto3, kubernetes, jmespath"
                value={pip}
                onChange={(e) => setPip(e.target.value)}
                onBlur={() =>
                  pip !== settings.controlNodePipPackages && onSave({ controlNodePipPackages: pip })
                }
              />
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <Boxes className="size-3" /> Collections
              </label>
              <Textarea
                className="font-mono text-[11px]"
                rows={2}
                placeholder="community.docker, kubernetes.core"
                value={colls}
                onChange={(e) => setColls(e.target.value)}
                onBlur={() =>
                  colls !== settings.controlNodeCollections && onSave({ controlNodeCollections: colls })
                }
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy || !status?.engine} onClick={onBuild}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Hammer className="size-4" />}
              {status?.imageBuilt ? 'Rebuild image' : 'Build image'}
            </Button>
            {status?.imageBuilt && (
              <Button size="sm" variant="ghost" onClick={onTeardown}>
                <Trash2 className="size-4" /> Remove image
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
