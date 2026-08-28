import { EXTERNAL_RESOURCE_LINKS, type ResourceType } from '@/core/cheatsheets/cheatsheetContent'
import { ResourceLinkListView } from './ResourceLinkListView'

const TYPE: ResourceType = 'aiApp'

/**
 * End-user AI software — agents, desktop apps, and products you run rather
 * than build on. Knowledge Hub "AI & Automation" group.
 * See KNOWLEDGE_HUB_AI_EXPANSION_PLAN.md.
 */
export function AiSoftwareScreen() {
  const links = EXTERNAL_RESOURCE_LINKS.filter((l) => l.type === TYPE)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-5">
        <h1 className="text-[17px] font-semibold tracking-tight">AI Software</h1>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <ResourceLinkListView
          description="AI apps and agents you run as a user — chat clients, desktop agents, coding tools. Filter by tag (audio, design, research, finance, …)."
          links={links}
        />
      </div>
    </div>
  )
}
