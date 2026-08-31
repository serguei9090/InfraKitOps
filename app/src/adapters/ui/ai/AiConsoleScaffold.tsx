import { useEffect } from 'react'
import { MessagesSquare, Plug, Wand2 } from 'lucide-react'
import { useBackendStore } from '@/stores/backendStore'
import { useLlmStore, type Section } from '@/stores/llmStore'
import { useVaultStore } from '@/stores/vaultStore'
import { cn } from '@/lib/utils'
import { BackendUnavailable } from '@/adapters/ui/network/BackendUnavailable'
import { VaultDialog } from '@/adapters/ui/runbook/VaultDialog'
import { ConnectionsView } from './ConnectionsView'
import { PlaygroundView } from './PlaygroundView'
import { TasksView } from './TasksView'

const NAV: { id: Section; label: string; icon: typeof Plug }[] = [
  { id: 'playground', label: 'Playground', icon: MessagesSquare },
  { id: 'connections', label: 'Connections', icon: Plug },
  { id: 'tasks', label: 'Tasks', icon: Wand2 },
]

/**
 * T7 "Console Workspace" — the AI module's single screen. Own top nav,
 * full-width body, bottom status strip. Backend-mandatory (providers, keys,
 * streaming), so a missing backend shows the connect state.
 * See AI_MODULE_PLAN.md §7.
 */
export function AiConsoleScaffold() {
  const status = useBackendStore((s) => s.status)
  const retry = useBackendStore((s) => s.retry)
  const refreshBackend = useBackendStore((s) => s.refresh)

  const section = useLlmStore((s) => s.section)
  const setSection = useLlmStore((s) => s.setSection)
  const refresh = useLlmStore((s) => s.refresh)
  const refreshTasks = useLlmStore((s) => s.refreshTasks)
  const refreshSettings = useLlmStore((s) => s.refreshSettings)
  const connections = useLlmStore((s) => s.connections)
  const refreshVault = useVaultStore((s) => s.refresh)

  useEffect(() => {
    if (status === 'unknown') void refreshBackend()
  }, [status, refreshBackend])

  useEffect(() => {
    if (status === 'available') {
      void refresh()
      void refreshTasks()
      void refreshSettings()
      void refreshVault()
    }
  }, [status, refresh, refreshTasks, refreshSettings, refreshVault])

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

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <Header>
        <nav className="flex items-center gap-0.5 overflow-x-auto">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setSection(n.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm',
                section === n.id
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
        <VaultDialog />
      </Header>

      <div className="min-h-0 flex-1 overflow-auto">
        {section === 'playground' && <PlaygroundView />}
        {section === 'connections' && <ConnectionsView />}
        {section === 'tasks' && <TasksView />}
      </div>

      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-border/60 bg-card px-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500" /> backend connected
        </span>
        <span>·</span>
        <span>
          {connections.length} connection{connections.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  )
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-5">
      <h1 className="text-[17px] font-semibold tracking-tight">AI Hub</h1>
      <div className="mx-2 h-5 w-px bg-border/60" />
      {children}
    </div>
  )
}
