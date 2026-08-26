import { LayoutGrid, Settings } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useModuleVisibilityStore, visibleModulesInOrder } from '@/stores/moduleVisibilityStore'
import { useSearchQueryStore } from '@/stores/searchQueryStore'
import { ModuleSettingsDialog } from './ModuleSettingsDialog'
import { moduleContainingRoute, type ModuleDef } from './moduleTaxonomy'

/**
 * Persistent icon rail (module switcher, never hides) + an adjacent swap
 * pane listing the active module's tools. Clicking a different rail icon
 * swaps the pane's contents in place — no back button, current module
 * always visible via the highlighted icon. Adding a new tool/module never
 * touches this file — it renders off kModuleTaxonomy + useModuleVisibilityStore.
 *
 * Note: the Flutter reference collapses the inline pane into a bottom-sheet
 * below a 720px width breakpoint (see design.md). Deferred here — this is a
 * desktop-first port; the compact/mobile variant is a fast-follow, not
 * blocking Phase 2.
 */
export function AppSidebar() {
  const { pathname } = useLocation()
  const { order, hiddenIds } = useModuleVisibilityStore()
  const modules = visibleModulesInOrder(order, hiddenIds)
  const activeModuleId = activeModuleIdFor(pathname)
  const activeModule = modules.find((m) => m.id === activeModuleId) ?? null

  return (
    <div className="flex h-full shrink-0">
      <ModuleRail modules={modules} activeModuleId={activeModuleId} />
      <div className="w-px shrink-0 bg-border/60" />
      <div
        className={cn(
          'overflow-hidden transition-[width] duration-150 ease-out',
          activeModule ? 'w-60' : 'w-0',
        )}
      >
        {activeModule ? <ToolListPane module={activeModule} currentPath={pathname} /> : null}
      </div>
    </div>
  )
}

function activeModuleIdFor(pathname: string): string | null {
  if (pathname === '/') return null
  if (pathname.startsWith('/modules/')) return pathname.slice('/modules/'.length)
  return moduleContainingRoute(pathname)?.id ?? null
}

function ModuleRail({ modules, activeModuleId }: { modules: ModuleDef[]; activeModuleId: string | null }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <nav aria-label="Modules" className="flex w-16 shrink-0 flex-col items-center gap-1 py-2">
      <RailIcon icon={LayoutGrid} label="All Tools" selected={pathname === '/'} onClick={() => navigate('/')} />
      <div className="my-2 h-px w-8 bg-border" />
      <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
        {modules.map((module) => (
          <RailIcon
            key={module.id}
            icon={module.icon}
            label={module.title}
            selected={module.id === activeModuleId}
            onClick={() => navigate(`/modules/${module.id}`)}
          />
        ))}
      </div>
      <ModuleSettingsDialog
        trigger={
          <button
            type="button"
            aria-label="Rearrange modules"
            className="flex size-9 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          >
            <Settings className="size-[18px]" />
          </button>
        }
      />
    </nav>
  )
}

function RailIcon({
  icon: Icon,
  label,
  selected,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        onClick={onClick}
        className={cn(
          'flex size-11 items-center justify-center rounded-[10px] transition-colors',
          selected ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
        )}
      >
        <Icon className="size-[22px]" />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function ToolListPane({ module, currentPath }: { module: ModuleDef; currentPath: string }) {
  const navigate = useNavigate()
  const query = useSearchQueryStore((s) => s.query.trim().toLowerCase())

  const tools = query
    ? module.tools.filter(
        (t) => t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query),
      )
    : module.tools

  return (
    <div className="flex h-full w-60 flex-col overflow-hidden">
      <p className="truncate px-4 pt-4 pb-2 text-sm font-bold text-foreground">{module.title}</p>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {tools.map((tool) => {
          const Icon = tool.icon
          const enabled = Boolean(tool.route)
          const selected = enabled && currentPath === tool.route
          return (
            <button
              key={tool.id}
              type="button"
              disabled={!enabled}
              onClick={() => tool.route && navigate(tool.route)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm',
                selected && 'bg-primary/15 text-foreground font-medium',
                !selected && enabled && 'text-foreground hover:bg-accent/40',
                !enabled && 'text-muted-foreground opacity-60',
              )}
            >
              <Icon className="size-[18px] shrink-0" />
              <span className="flex-1 truncate">{tool.name}</span>
              {!enabled ? <span className="text-[10px] text-muted-foreground">soon</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
