import { EXTERNAL_RESOURCE_LINKS, type ResourceType } from '@/core/cheatsheets/cheatsheetContent'
import { ResourceLinkListView } from './ResourceLinkListView'

const TYPE: ResourceType = 'automation'

/**
 * Automation platforms and workflow engines — n8n, Activepieces, Windmill,
 * Kestra and friends. Knowledge Hub "AI & Automation" group.
 * See KNOWLEDGE_HUB_AI_EXPANSION_PLAN.md.
 */
export function AutomationScreen() {
  const links = EXTERNAL_RESOURCE_LINKS.filter((l) => l.type === TYPE)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-5">
        <h1 className="text-[17px] font-semibold tracking-tight">Automation</h1>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <ResourceLinkListView
          description="Workflow automation platforms and orchestration engines — self-hosted and SaaS."
          links={links}
        />
      </div>
    </div>
  )
}
