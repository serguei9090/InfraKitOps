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
  Network,
  PackagePlus,
  SquareTerminal,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { listNodes } from '@/adapters/backend/runbookClient'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import * as api from '@/adapters/backend/ansibleClient'
import { useAnsibleStore } from '@/stores/ansibleStore'
import { useAuthStore } from '@/stores/authStore'
import type { AnsibleSettings, RunnerStatus } from '@/core/ansible/ansibleModel'

const MODE_HINT: Record<string, string> = {
  auto: 'First that works: system → managed → container → wsl',
  system: 'The ansible binaries on your PATH (Linux/macOS)',
  managed: 'An InfraKit-managed uv virtualenv (Linux/macOS)',
  container: 'Run ansible inside a Docker / Podman container — works on Windows',
  wsl: 'Run ansible inside a WSL2 distro — Windows, no Docker',
  remote: 'Run ansible on a remote Linux host over SSH (an SSH node)',
}

const MODE_ICON: Record<string, typeof Cpu> = {
  auto: Cpu,
  system: Terminal,
  managed: PackagePlus,
  container: Container,
  wsl: SquareTerminal,
  remote: Network,
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
  const modes: string[] = (
    settings.os === 'windows'
      ? ['auto', 'container', 'wsl', 'system', 'managed']
      : ['auto', 'system', 'managed', 'container', 'wsl']
  ).concat(runners.remote ? ['remote'] : [])

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
        {settings.runtime === 'wsl' && (
          <WslSetup
            settings={settings}
            status={runners.wsl}
            busy={busySetup}
            admin={isAdmin}
            install={settings.install?.wsl}
            onSetup={() => setupRuntime('wsl')}
            onTeardown={async () => {
              await api.teardownRuntime('wsl')
              void refreshSettings()
            }}
            onSave={(patch) => void save(patch)}
          />
        )}
        {settings.runtime === 'remote' && (
          <RemoteSetup
            settings={settings}
            status={runners.remote}
            busy={busySetup}
            admin={isAdmin}
            onSetup={() => setupRuntime('remote')}
            onSave={(patch) => void save(patch)}
          />
        )}

        {/* shared control-node deps */}
        {isAdmin && ['managed', 'container', 'wsl', 'remote'].includes(settings.runtime) && (
          <DepsEditor
            settings={settings}
            busy={busySetup}
            onSave={(patch) => void save(patch)}
            onApply={() => useAnsibleStore.getState().applyDeps(settings.runtime)}
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
  useEffect(() => setImage(settings.containerImage), [settings])

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

function WslSetup({
  settings,
  status,
  busy,
  admin,
  install,
  onSetup,
  onTeardown,
  onSave,
}: {
  settings: AnsibleSettings
  status?: RunnerStatus
  busy: boolean
  admin: boolean
  install?: string
  onSetup: () => void
  onTeardown: () => void
  onSave: (patch: Parameters<typeof api.putSettings>[0]) => void
}) {
  const DEDICATED = 'InfraKit-Ansible'
  const distros = status?.distros ?? []
  const online = status?.onlineDistros ?? []
  const [distro, setDistro] = useState(settings.wslDistro || DEDICATED)
  const [source, setSource] = useState(settings.wslSource || 'import:')
  useEffect(() => {
    setDistro(settings.wslDistro || DEDICATED)
    setSource(settings.wslSource || 'import:')
  }, [settings])

  if (!status?.wslInstalled) {
    return (
      <div className="rounded-lg border border-border/60 p-3 text-sm">
        <p className="mb-2 text-muted-foreground">WSL is not installed.</p>
        {install && (
          <a
            href={install}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-xs hover:bg-accent/40"
          >
            Install WSL <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    )
  }

  const dedicated = distro === DEDICATED

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-3 text-sm">
      <div className="flex items-center gap-2">
        {status.ready ? (
          <CheckCircle2 className="size-4 text-emerald-500" />
        ) : (
          <XCircle className="size-4 text-muted-foreground" />
        )}
        <span className="font-medium">
          {status.ready ? `${status.distro} · ${status.ansibleVersion}` : status.reason}
        </span>
      </div>

      {admin && (
        <>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Distro to run ansible in</label>
            <Select value={distro} onValueChange={(v) => v && setDistro(v)}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEDICATED}>{DEDICATED} (dedicated, InfraKit-managed)</SelectItem>
                {distros
                  .filter((d) => d !== DEDICATED)
                  .map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {dedicated && !status.distroReady && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Base image for the new distro</label>
              <Select value={source} onValueChange={(v) => v && setSource(v)}>
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="import:">Ubuntu (download official WSL rootfs)</SelectItem>
                  {online.map((d) => (
                    <SelectItem key={d} value={`official:${d}`}>
                      {d} (from the Microsoft store — installs as “{d}”)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Or paste a rootfs path / URL: use <code>import:C:\path\to\rootfs.tar</code>
              </p>
              <Input
                className="h-8 font-mono text-[11px]"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="import:  |  import:C:\rootfs.tar  |  official:Debian"
              />
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                onSave({ wslDistro: distro === DEDICATED ? '' : distro, wslSource: source })
                onSetup()
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Hammer className="size-4" />}
              {status.ready ? 'Reinstall ansible' : dedicated ? 'Set up dedicated distro' : 'Install ansible in ' + distro}
            </Button>
            {dedicated && status.distroReady && (
              <Button size="sm" variant="ghost" onClick={onTeardown}>
                <Trash2 className="size-4" /> Unregister distro
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function DepsEditor({
  settings,
  busy,
  onSave,
  onApply,
}: {
  settings: AnsibleSettings
  busy: boolean
  onSave: (patch: Parameters<typeof api.putSettings>[0]) => void
  onApply: () => void
}) {
  const [pip, setPip] = useState(settings.controlNodePipPackages)
  const [colls, setColls] = useState(settings.controlNodeCollections)
  useEffect(() => {
    setPip(settings.controlNodePipPackages)
    setColls(settings.controlNodeCollections)
  }, [settings])

  const dirty = pip !== settings.controlNodePipPackages || colls !== settings.controlNodeCollections

  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3 text-sm">
      <div className="text-xs font-semibold uppercase text-muted-foreground">Control-node dependencies</div>
      <p className="text-[11px] text-muted-foreground">
        Extra Python libs + collections the control node needs — e.g. <code>boto3</code> for{' '}
        <code>community.aws</code>, <code>jmespath</code> for <code>json_query</code>. Applied to the active
        runtime.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <PackagePlus className="size-3" /> pip packages
          </label>
          <Textarea
            className="font-mono text-[11px]"
            rows={2}
            placeholder="boto3, kubernetes, jmespath, netaddr"
            value={pip}
            onChange={(e) => setPip(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <Boxes className="size-3" /> collections
          </label>
          <Textarea
            className="font-mono text-[11px]"
            rows={2}
            placeholder="community.aws, kubernetes.core"
            value={colls}
            onChange={(e) => setColls(e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={!dirty}
          onClick={() => onSave({ controlNodePipPackages: pip, controlNodeCollections: colls })}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || dirty}
          onClick={onApply}
          title={dirty ? 'Save first' : undefined}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
          Install deps now
        </Button>
      </div>
    </div>
  )
}

function RemoteSetup({
  settings,
  status,
  busy,
  admin,
  onSetup,
  onSave,
}: {
  settings: AnsibleSettings
  status?: RunnerStatus
  busy: boolean
  admin: boolean
  onSetup: () => void
  onSave: (patch: Parameters<typeof api.putSettings>[0]) => void
}) {
  const [nodes, setNodes] = useState<{ id: string; name: string; host: string; user: string }[]>([])
  const [node, setNode] = useState(settings.remoteNodeId)
  const [workdir, setWorkdir] = useState(settings.remoteWorkdir)
  const [projPath, setProjPath] = useState(settings.remoteProjectPath)
  useEffect(() => {
    listNodes()
      .then((ns) => setNodes(ns.map((n) => ({ id: n.id, name: n.name, host: n.host, user: n.user }))))
      .catch(() => setNodes([]))
  }, [])
  useEffect(() => {
    setNode(settings.remoteNodeId)
    setWorkdir(settings.remoteWorkdir)
    setProjPath(settings.remoteProjectPath)
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
          {status?.ready ? `${status.remote} · ${status.ansibleVersion}` : (status?.reason ?? 'no control node')}
        </span>
      </div>

      {admin && (
        <>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              Control node (an SSH node from Runbooks → Nodes)
            </label>
            {nodes.length === 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                No SSH nodes. Add one in Runbooks → Nodes first.
              </p>
            ) : (
              <Select value={node || ''} onValueChange={(v) => v && onSave({ remoteNodeId: v })}>
                <SelectTrigger size="sm">
                  <SelectValue placeholder="pick a node" />
                </SelectTrigger>
                <SelectContent>
                  {nodes.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.name} — {n.user}@{n.host}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Remote work dir</label>
              <Input
                className="h-8 font-mono text-[11px]"
                placeholder="~/.infrakit-ansible"
                value={workdir}
                onChange={(e) => setWorkdir(e.target.value)}
                onBlur={() => workdir !== settings.remoteWorkdir && onSave({ remoteWorkdir: workdir })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Project already on the remote? (path — skips the sync)
              </label>
              <Input
                className="h-8 font-mono text-[11px]"
                placeholder="(sync each run)"
                value={projPath}
                onChange={(e) => setProjPath(e.target.value)}
                onBlur={() => projPath !== settings.remoteProjectPath && onSave({ remoteProjectPath: projPath })}
              />
            </div>
          </div>
          <Button size="sm" variant="outline" disabled={busy || !node} onClick={onSetup}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Hammer className="size-4" />}
            Set up control node
          </Button>
        </>
      )}
    </div>
  )
}
