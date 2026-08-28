import { EXTERNAL_RESOURCE_LINKS } from '@/core/cheatsheets/cheatsheetContent'
import { ResourceLinkListView } from './ResourceLinkListView'

/**
 * Every index / directory / aggregator across the AI & Automation group —
 * "there's an AI for that" catalogs, MCP registries, model rankings, agent
 * lists. Filters on `isDirectory` rather than a single `type` so it spans all
 * of them. See KNOWLEDGE_HUB_AI_EXPANSION_PLAN.md §3.
 */
export function AiCatalogsScreen() {
  const links = EXTERNAL_RESOURCE_LINKS.filter((l) => l.isDirectory === true)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-5">
        <h1 className="text-[17px] font-semibold tracking-tight">AI Catalogs &amp; Directories</h1>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <ResourceLinkListView
          description="Directories and aggregators — start here to browse. Registries, awesome-lists, tool indexes and model leaderboards across MCP, agents, frameworks and automation."
          links={links}
        />
      </div>
    </div>
  )
}
