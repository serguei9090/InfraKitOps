import { FolderOpen, LayoutGrid, PanelLeft, PanelLeftClose, Pencil, Settings, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { createSchemaRepository } from '@/adapters/storage/schemaRepository'
import { NetworkSettingsDialog } from '@/adapters/ui/network/NetworkSettingsDialog'
import { useModuleVisibilityStore, visibleModulesInOrder } from '@/stores/moduleVisibilityStore'
import { useSearchQueryStore } from '@/stores/searchQueryStore'
import { ModuleSettingsDialog } from './ModuleSettingsDialog'
import { moduleContainingRoute, moduleRailRoute, type ModuleDef } from './moduleTaxonomy'

const schemaRepository = createSchemaRepository()
const FORMFLOW_BUILDER_ROUTE = '/tools/formflow-builder'

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
  const showPane = activeModule != null && !activeModule.hideToolPane

  return (
    <div className="flex h-full shrink-0">
      <ModuleRail modules={modules} activeModuleId={activeModuleId} />
      <div className="w-px shrink-0 bg-border/60" />
      <div
        className={cn(
          'overflow-hidden transition-[width] duration-150 ease-out',
          showPane ? 'w-60' : 'w-0',
        )}
      >
        {showPane ? <ToolListPane module={activeModule} currentPath={pathname} /> : null}
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
  const expanded = useModuleVisibilityStore((s) => s.railExpanded)
  const toggle = useModuleVisibilityStore((s) => s.toggleRailExpanded)

  return (
    <nav
      aria-label="Modules"
      className={cn(
        'flex shrink-0 flex-col gap-1 py-2 transition-[width] duration-150 ease-out',
        expanded ? 'w-52 items-stretch px-2' : 'w-16 items-center',
      )}
    >
      <RailIcon
        icon={expanded ? PanelLeftClose : PanelLeft}
        label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        expanded={expanded}
        onClick={toggle}
      />
      <RailIcon
        icon={LayoutGrid}
        label="All Tools"
        expanded={expanded}
        selected={pathname === '/'}
        onClick={() => navigate('/')}
      />
      <div className={cn('my-2 h-px bg-border', expanded ? 'mx-2' : 'w-8')} />
      <div className={cn('flex flex-1 flex-col gap-1 overflow-y-auto', !expanded && 'items-center')}>
        {modules.map((module) => (
          <RailIcon
            key={module.id}
            icon={module.icon}
            label={module.title}
            expanded={expanded}
            selected={module.id === activeModuleId}
            onClick={() => navigate(moduleRailRoute(module))}
          />
        ))}
      </div>
      <ModuleSettingsDialog
        trigger={
          <button
            type="button"
            aria-label="Rearrange modules"
            className={cn(
              'flex items-center gap-2.5 rounded-[10px] text-muted-foreground hover:bg-accent/40 hover:text-foreground',
              expanded ? 'w-full px-2.5 py-2 text-sm' : 'size-9 justify-center',
            )}
          >
            <Settings className="size-[18px] shrink-0" />
            {expanded ? <span className="truncate">Rearrange modules</span> : null}
          </button>
        }
      />
    </nav>
  )
}

function RailIcon({
  icon: Icon,
  label,
  selected = false,
  expanded,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  selected?: boolean
  expanded: boolean
  onClick: () => void
}) {
  const base = cn(
    'flex items-center rounded-[10px] transition-colors',
    expanded ? 'w-full gap-2.5 px-2.5 py-2 text-sm' : 'size-11 justify-center',
    selected
      ? 'bg-primary/15 text-primary font-medium'
      : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
  )

  const content = (
    <>
      <Icon className={expanded ? 'size-[18px] shrink-0' : 'size-[22px]'} />
      {expanded ? <span className="flex-1 truncate">{label}</span> : null}
    </>
  )

  if (expanded) {
    return (
      <button type="button" aria-label={label} onClick={onClick} className={base}>
        {content}
      </button>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger aria-label={label} onClick={onClick} className={base}>
        {content}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function ToolListPane({ module, currentPath }: { module: ModuleDef; currentPath: string }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const query = useSearchQueryStore((s) => s.query.trim().toLowerCase())

  const tools = query
    ? module.tools.filter(
        (t) => t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query),
      )
    : module.tools

  const openTemplateName = currentPath === FORMFLOW_BUILDER_ROUTE ? searchParams.get('t') : null

  return (
    <div className="flex h-full w-60 flex-col overflow-hidden">
      <p className="truncate px-4 pt-4 pb-2 text-sm font-bold text-foreground">{module.title}</p>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {tools.map((tool, i) => {
          const Icon = tool.icon
          const enabled = Boolean(tool.route)
          // The FormFlow builder route is shared by the "new design" entry and
          // every saved template's fill/edit view (disambiguated by `?t=`) —
          // this row owns the highlight only when no template is open.
          const selected = enabled && currentPath === tool.route && !(tool.id === 'formflow-builder' && openTemplateName)
          // Group heading: shown when not searching and this tool starts a new
          // group. The first one gets no divider rule (module title is above).
          const showHeading = !query && Boolean(tool.group) && tool.group !== tools[i - 1]?.group
          return (
            <div key={tool.id}>
              {showHeading ? (
                <p
                  className={cn(
                    'px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70',
                    i > 0 && 'mt-3 border-t border-border/50 pt-3',
                  )}
                >
                  {tool.group}
                </p>
              ) : null}
              <button
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
            </div>
          )
        })}
        {module.id === 'formflow' ? (
          <FormFlowTemplateRows openTemplateName={openTemplateName} navigate={navigate} />
        ) : null}
      </div>
      {module.id === 'network' ? (
        <div className="border-t border-border/60 px-2 py-2">
          <NetworkSettingsDialog
            trigger={
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm text-muted-foreground hover:bg-accent/40 hover:text-foreground"
              >
                <Settings className="size-[18px] shrink-0" />
                <span className="flex-1 truncate">Toolkit settings</span>
              </button>
            }
          />
        </div>
      ) : null}
    </div>
  )
}

/**
 * Saved FormFlow templates, listed under the "XML/YAML Form Designer" nav
 * item. Name → fill mode (`?t=name`, live form + Download/Preview/Copy).
 * Pencil → design mode (`?t=name&mode=edit`, schema/field mapper, no
 * Download/Preview/Copy). Refetches on every open/close so a save or delete
 * elsewhere is reflected without a dedicated pub/sub channel.
 */
function FormFlowTemplateRows({
  openTemplateName,
  navigate,
}: {
  openTemplateName: string | null
  navigate: ReturnType<typeof useNavigate>
}) {
  const [names, setNames] = useState<string[] | null>(null)
  const [toDelete, setToDelete] = useState<string | null>(null)

  function refresh() {
    schemaRepository.listNames().then(setNames)
  }

  useEffect(refresh, [openTemplateName])

  async function confirmDelete() {
    if (!toDelete) return
    await schemaRepository.delete(toDelete)
    if (openTemplateName === toDelete) navigate(FORMFLOW_BUILDER_ROUTE)
    setToDelete(null)
    refresh()
  }

  if (!names || names.length === 0) return null

  return (
    <>
      <div className="mt-1 flex flex-col gap-0.5 border-t border-border/60 pt-1">
        {names.map((name) => {
          const selected = openTemplateName === name
          return (
            <div
              key={name}
              className={cn(
                'group flex items-center gap-1 rounded-[10px] pl-2.5 pr-1 py-1 text-sm',
                selected ? 'bg-primary/15 text-foreground font-medium' : 'text-foreground hover:bg-accent/40',
              )}
            >
              <FolderOpen className="size-[15px] shrink-0 text-muted-foreground" />
              <button
                type="button"
                onClick={() => navigate(`${FORMFLOW_BUILDER_ROUTE}?t=${encodeURIComponent(name)}`)}
                className="min-w-0 flex-1 truncate py-1 text-left"
              >
                {name}
              </button>
              <button
                type="button"
                aria-label={`Edit "${name}"`}
                onClick={() => navigate(`${FORMFLOW_BUILDER_ROUTE}?t=${encodeURIComponent(name)}&mode=edit`)}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Delete "${name}"`}
                onClick={() => setToDelete(name)}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>
      <Dialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete template?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">"{toDelete}" will be permanently deleted. This cannot be undone.</p>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
