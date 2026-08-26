import { ArrowUpRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ModuleDef, ToolEntry } from './moduleTaxonomy'

interface ModuleSectionViewProps {
  module: ModuleDef
  /** Tapping the section header navigates to '/modules/:id'. Pass false when already there. */
  linkHeaderToModulePage?: boolean
}

/**
 * One module's header + tool-card grid. Shared by HomeDashboardScreen (all
 * modules stacked, page 1) and ModuleToolsScreen (a single module, page 2)
 * so the two pages never duplicate this layout.
 */
export function ModuleSectionView({ module, linkHeaderToModulePage = true }: ModuleSectionViewProps) {
  const navigate = useNavigate()
  const implemented = module.tools.filter((t) => t.route).length
  const Icon = module.icon

  const header = (
    <div className="flex items-center gap-2">
      <Icon className="size-5 text-foreground" />
      <h2 className="truncate text-xl font-bold tracking-tight text-foreground">{module.title}</h2>
    </div>
  )

  return (
    <div className="pb-8">
      {linkHeaderToModulePage ? (
        <button
          type="button"
          className="rounded-lg py-1 text-left hover:bg-accent/40"
          onClick={() => navigate(`/modules/${module.id}`)}
        >
          {header}
        </button>
      ) : (
        header
      )}
      <p className="mt-1 text-sm text-muted-foreground">
        {implemented} of {module.tools.length} tools live
      </p>
      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {module.tools.map((tool) => (
          <ToolCard key={tool.id} tool={tool} />
        ))}
      </div>
    </div>
  )
}

function ToolCard({ tool }: { tool: ToolEntry }) {
  const navigate = useNavigate()
  const enabled = Boolean(tool.route)
  const Icon = tool.icon

  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={() => tool.route && navigate(tool.route)}
      className={cn(
        'group flex flex-col items-start rounded-2xl border border-border/60 bg-card p-[18px] text-left transition-all duration-150',
        enabled
          ? 'cursor-pointer hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/30'
          : 'cursor-default opacity-55',
      )}
    >
      <div className="flex w-full items-center">
        <div className="flex size-9 items-center justify-center rounded-[10px] bg-primary/15">
          <Icon className="size-[19px] text-primary" />
        </div>
        <div className="flex-1" />
        {enabled ? (
          <ArrowUpRight className="size-[18px] text-primary opacity-0 transition-opacity group-hover:opacity-100" />
        ) : (
          <Badge variant="secondary" className="text-[10px] font-normal text-muted-foreground">
            Coming soon
          </Badge>
        )}
      </div>
      <p className="mt-3 line-clamp-1 text-[15px] font-semibold tracking-tight text-foreground">{tool.name}</p>
      <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{tool.description}</p>
    </button>
  )
}
