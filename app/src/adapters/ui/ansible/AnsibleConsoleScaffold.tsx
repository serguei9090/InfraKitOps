import { useEffect } from 'react'
import { FolderGit2, History, ListChecks, Network, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBackendStore } from '@/stores/backendStore'
import { useAnsibleStore, type Section } from '@/stores/ansibleStore'
import { BackendUnavailable } from '@/adapters/ui/network/BackendUnavailable'
import { ProjectsView } from './ProjectsView'
import { InventoryView } from './InventoryView'
import { JobsView } from './JobsView'
import { HistoryView } from './HistoryView'
import { RuntimePanel } from './RuntimePanel'
import { RunView } from './RunView'

const NAV: { id: Section; label: string; icon: typeof History }[] = [
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'inventory', label: 'Inventory', icon: Network },
  { id: 'jobs', label: 'Jobs', icon: ListChecks },
  { id: 'history', label: 'History', icon: History },
]

/**
 * T7 "Console Workspace" for the Ansible Manager module — own top nav, a
 * runtime/workspace strip, and a bottom sheet for the live play/task/host
 * tree. Backend-mandatory. See ANSIBLE_MODULE_PLAN.md.
 */
export function AnsibleConsoleScaffold() {
  const status = useBackendStore((s) => s.status)
  const retry = useBackendStore((s) => s.retry)
  const refreshBackend = useBackendStore((s) => s.refresh)

  const section = useAnsibleStore((s) => s.section)
  const setSection = useAnsibleStore((s) => s.setSection)
  const settings = useAnsibleStore((s) => s.settings)
  const refreshSettings = useAnsibleStore((s) => s.refreshSettings)
  const refreshProjects = useAnsibleStore((s) => s.refreshProjects)
  const live = useAnsibleStore((s) => s.live)
  const showRuntime = useAnsibleStore((s) => s.showRuntime)
  const setShowRuntime = useAnsibleStore((s) => s.setShowRuntime)

  useEffect(() => {
    if (status === 'unknown') void refreshBackend()
  }, [status, refreshBackend])

  useEffect(() => {
    if (status === 'available') {
      void refreshSettings()
      void refreshProjects()
    }
  }, [status, refreshSettings, refreshProjects])

  const ready = settings?.capabilities.ready ?? false
  const needsSetup = settings != null && (!ready || !settings.workspaceDir)

  if (status === 'unavailable' || status === 'connecting' || status === 'unknown') {
    return (
      <div className="flex h-full flex-col">
        <Header />
        <div className="flex-1 overflow-auto p-6">
          <BackendUnavailable onRetry={() => void retry()} retrying={status === 'connecting'} />
        </div>
      </div>
    )
  }

  const forceRuntime = showRuntime || (needsSetup && !showRuntime && section === 'projects')

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <Header>
        <nav className="flex items-center gap-0.5">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                setShowRuntime(false)
                setSection(n.id)
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm',
                section === n.id && !forceRuntime
                  ? 'bg-primary/15 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
              )}
            >
              <n.icon className="size-4" />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setShowRuntime(!showRuntime)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm',
            forceRuntime
              ? 'bg-primary/15 text-primary font-medium'
              : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
          )}
        >
          <Settings2 className="size-4" />
          Runtime
          {needsSetup && <span className="size-1.5 rounded-full bg-amber-500" />}
        </button>
      </Header>

      <div className="min-h-0 flex-1 overflow-auto">
        {forceRuntime ? (
          <RuntimePanel />
        ) : section === 'projects' ? (
          <ProjectsView />
        ) : section === 'inventory' ? (
          <InventoryView />
        ) : section === 'jobs' ? (
          <JobsView />
        ) : (
          <HistoryView />
        )}
      </div>

      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-border/60 bg-card px-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={cn('size-1.5 rounded-full', ready ? 'bg-emerald-500' : 'bg-amber-500')} />
          {ready ? `ansible ${settings?.capabilities.runtime}` : 'ansible not ready'}
        </span>
        <span>·</span>
        <span className="truncate">workspace: {settings?.workspaceDir || '(not set)'}</span>
      </div>

      {live && <RunView />}
    </div>
  )
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-5">
      <h1 className="text-[17px] font-semibold tracking-tight">Ansible</h1>
      <div className="mx-2 h-5 w-px bg-border/60" />
      {children}
    </div>
  )
}
