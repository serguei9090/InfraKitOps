import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, CalendarClock, History, Lock, LockOpen, Network, Package, Plus, ShieldQuestion, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBackendStore } from '@/stores/backendStore'
import { useRunbookStore, type Section } from '@/stores/runbookStore'
import { useRunsStore } from '@/stores/runsStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import { BackendUnavailable } from '@/adapters/ui/network/BackendUnavailable'
import { LibraryView } from './LibraryView'
import { HistoryView } from './HistoryView'
import { SshNodesView } from './SshNodesView'
import { PackagesView } from './PackagesView'
import { SchedulesView } from './SchedulesView'
import { ApprovalsView } from './ApprovalsView'
import { AssistantView } from './AssistantView'
import { VaultDialog } from './VaultDialog'
import { LibrarySyncDialog } from './LibrarySyncDialog'
import { RunPanel } from './RunPanel'

const NAV: { id: Section; label: string; icon: typeof History }[] = [
  { id: 'library', label: 'Library', icon: Boxes },
  { id: 'history', label: 'History', icon: History },
  { id: 'schedules', label: 'Schedules', icon: CalendarClock },
  { id: 'nodes', label: 'Nodes', icon: Network },
  { id: 'packages', label: 'Packages', icon: Package },
  { id: 'assistant', label: 'Assistant', icon: Sparkles },
]

/**
 * T7 "Console Workspace" — the Runbooks module's single screen. Own top nav
 * (sections are peers), full-width body, bottom status strip. The whole module
 * is backend-mandatory, so a missing backend shows the connect state.
 * See RUNBOOK_MODULE_PLAN.md §7.
 */
export function RunbookConsoleScaffold() {
  const status = useBackendStore((s) => s.status)
  const retry = useBackendStore((s) => s.retry)
  const refreshBackend = useBackendStore((s) => s.refresh)
  const capabilities = useBackendStore((s) => s.capabilities)
  const runnableExecutors = useMemo(
    () =>
      Object.entries(capabilities?.runbookExecutors ?? {})
        .filter(([, ok]) => ok)
        .map(([k]) => k),
    [capabilities],
  )

  const section = useRunbookStore((s) => s.section)
  const setSection = useRunbookStore((s) => s.setSection)
  const refresh = useRunbookStore((s) => s.refresh)
  const pendingCount = useRunbookStore((s) => s.pendingApprovals.length)
  const refreshApprovals = useRunbookStore((s) => s.refreshPendingApprovals)
  const multiUser = useAuthStore((s) => s.mode === 'on')
  const refreshNodes = useRunbookStore((s) => s.refreshNodes)
  const refreshSchedules = useRunbookStore((s) => s.refreshSchedules)
  const createBlank = useRunbookStore((s) => s.createBlank)
  const live = useRunbookStore((s) => s.live)
  const attachRun = useRunbookStore((s) => s.attachRun)
  const attachRequest = useRunsStore((s) => s.attachRequest)
  const consumeAttach = useRunsStore((s) => s.consumeAttach)
  const navigate = useNavigate()

  async function newRunbook() {
    const rb = await createBlank()
    if (rb) navigate(`/tools/runbook/edit/${rb.id}`)
  }

  const vaultStatus = useVaultStore((s) => s.status)
  const refreshVault = useVaultStore((s) => s.refresh)

  useEffect(() => {
    if (status === 'unknown') void refreshBackend()
  }, [status, refreshBackend])

  // Came here from the global Runs drawer → re-attach the live view to that
  // still-executing server-side run (BR3b).
  useEffect(() => {
    const id = consumeAttach('runbook')
    if (id != null) void attachRun(id)
  }, [attachRequest, consumeAttach, attachRun])

  useEffect(() => {
    if (status === 'available') {
      void refresh()
      void refreshNodes()
      void refreshSchedules()
      void refreshVault()
      if (multiUser) void refreshApprovals()
    }
  }, [status, refresh, refreshNodes, refreshSchedules, refreshVault, multiUser, refreshApprovals])

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
          {multiUser && (
            <button
              type="button"
              onClick={() => setSection('approvals')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm',
                section === 'approvals'
                  ? 'bg-primary/15 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
              )}
            >
              <ShieldQuestion className="size-4" />
              Approvals
              {pendingCount > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white">
                  {pendingCount}
                </span>
              )}
            </button>
          )}
        </nav>
        <div className="flex-1" />
        <VaultDialog />
        <LibrarySyncDialog />
        <Button size="sm" onClick={() => void newRunbook()}>
          <Plus className="size-4" /> New runbook
        </Button>
      </Header>

      <div className="min-h-0 flex-1 overflow-auto">
        {section === 'library' && <LibraryView />}
        {section === 'history' && <HistoryView />}
        {section === 'schedules' && <SchedulesView />}
        {section === 'nodes' && <SshNodesView />}
        {section === 'packages' && <PackagesView />}
        {section === 'assistant' && <AssistantView />}
        {section === 'approvals' && <ApprovalsView />}
      </div>

      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-border/60 bg-card px-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500" /> backend connected
        </span>
        <span>·</span>
        <span>executors: {runnableExecutors.length ? runnableExecutors.join(' · ') : 'none'}</span>
        <span>·</span>
        <span className="flex items-center gap-1">
          {vaultStatus?.unlocked ? (
            <>
              <LockOpen className="size-3 text-emerald-500" /> vault unlocked
            </>
          ) : (
            <>
              <Lock className="size-3" /> vault {vaultStatus?.initialised ? 'locked' : 'not set up'}
            </>
          )}
        </span>
      </div>

      {live && <RunPanel />}
    </div>
  )
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-5">
      <h1 className="text-[17px] font-semibold tracking-tight">Runbooks</h1>
      <div className="mx-2 h-5 w-px bg-border/60" />
      {children}
    </div>
  )
}
